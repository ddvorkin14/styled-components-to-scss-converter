package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type StyledComponent struct {
	Name         string `json:"name"`
	CSS          string `json:"css"`
	Element      string `json:"element"`
	File         string `json:"file"`
	ConvertedJSX string `json:"convertedJSX"`
}

// Run Node parser on a file and return styled components
func parseFile(path string) ([]StyledComponent, error) {
	cmd := exec.Command("node", "parse-transform.mjs", path)
	cmd.Dir = "./parser"

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	outBytes, _ := io.ReadAll(stdout)
	errBytes, _ := io.ReadAll(stderr)
	cmd.Wait()

	fmt.Printf("parseFile: %s\n  stderr: %s\n  stdout: %s\n", path, string(errBytes), string(outBytes))

	/*
		if len(errBytes) > 0 {
			// Node parsing error → propagate as Go error
			fmt.Printf("Node parser error for %s:\n%s\n", path, string(errBytes))
			return nil, fmt.Errorf("node parser failed for %s", path)
		}
	*/

	var comps []StyledComponent
	if err := json.Unmarshal(outBytes, &comps); err != nil {
		fmt.Printf("JSON unmarshal error for %s:\n%s\n", path, string(outBytes))
		return nil, err
	}

	return comps, nil
}

func saveConverted(comp StyledComponent, scanDir string) {
	// Find the path segment starting from 'components'
	idx := strings.Index(comp.File, "/components/")
	if idx == -1 {
		// fallback to scanDir relative
		idx = len(scanDir) + 1
	}
	relPath := comp.File[idx+1:] // remove the leading slash before 'components'
	convertedPath := filepath.Join("tmp/converted", relPath)
	convertedPath = strings.ReplaceAll(convertedPath, "\\", "/")
	convertedPath = strings.TrimSuffix(convertedPath, filepath.Ext(convertedPath)) + ".scss-converted.tsx"

	os.MkdirAll(filepath.Dir(convertedPath), 0755)

	content := fmt.Sprintf(`// Converted %s
import './%s.scss';

export const %sConverted = () => {
  return %s;
};
`, comp.Name, comp.Name, comp.Name, comp.ConvertedJSX)

	os.WriteFile(convertedPath, []byte(content), 0644)
}

func saveEmptyConverted(filePath, scanDir string) {
	// Find the path segment starting from 'components'
	idx := strings.Index(filePath, "/components/")
	if idx == -1 {
		idx = len(scanDir) + 1
	}
	relPath := filePath[idx+1:]
	convertedPath := filepath.Join("tmp/converted", relPath)
	convertedPath = strings.ReplaceAll(convertedPath, "\\", "/")
	convertedPath = strings.TrimSuffix(convertedPath, filepath.Ext(convertedPath)) + ".scss-converted.tsx"

	os.MkdirAll(filepath.Dir(convertedPath), 0755)

	content := fmt.Sprintf(`// No styled-components found in %s
export const EmptyConverted = () => {
    return <div>Placeholder for %s</div>;
};
`, filepath.Base(filePath), filepath.Base(filePath))

	os.WriteFile(convertedPath, []byte(content), 0644)
}

// Scan handler
func scanDirHandler(w http.ResponseWriter, r *http.Request) {
	dir := r.URL.Query().Get("dir")
	if dir == "" {
		http.Error(w, "missing dir parameter", http.StatusBadRequest)
		return
	}

	var allStyledComponents []StyledComponent
	var allFiles []string

	// Check if we're listing the converted directory
	if strings.HasPrefix(dir, "tmp/converted") {
		var files []string
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() {
				// Get relative path from the input directory
				relPath, err := filepath.Rel(dir, path)
				if err != nil {
					return err
				}
				files = append(files, relPath)
			}
			return nil
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(files)
		return
	}

	// Regular component scanning
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() && (strings.Contains(path, "/spec") || strings.Contains(path, "/locales")) {
			return filepath.SkipDir
		}
		if !info.IsDir() {
			ext := strings.ToLower(filepath.Ext(path))
			// Skip already converted files and files in the tmp directory
			if strings.Contains(path, ".scss-converted.") || strings.Contains(path, "/tmp/") {
				return nil
			}
			if ext == ".js" || ext == ".jsx" || ext == ".ts" || ext == ".tsx" {
				allFiles = append(allFiles, path)
				comps, _ := parseFile(path)
				if len(comps) > 0 {
					allStyledComponents = append(allStyledComponents, comps...)
				}
			}
		}
		return nil
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Write all styled component info to a temp file
	styledInfoFile := "tmp/styled-info.json"
	styledInfoBytes, _ := json.Marshal(allStyledComponents)
	os.WriteFile(styledInfoFile, styledInfoBytes, 0644)

	// 2. Second pass: Refactor components that use styled-components
	for _, path := range allFiles {
		// Don't generate a converted component for style files
		if strings.HasSuffix(path, "styles.ts") {
			continue
		}

		cmd := exec.Command("node", "parser/refactor-component.mjs", path, styledInfoFile)
		refactoredBytes, err := cmd.Output()

		// Correctly calculate relative path to preserve directory structure
		relPath, err := filepath.Rel(filepath.Dir(dir), path)
		if err != nil {
			continue // or handle error
		}
		convertedPath := filepath.Join("tmp/converted", relPath)
		convertedPath = strings.TrimSuffix(convertedPath, filepath.Ext(convertedPath)) + ".scss-converted.tsx"
		os.MkdirAll(filepath.Dir(convertedPath), 0755)

		if err != nil {
			// If refactoring fails, save empty file with error
			errorContent := fmt.Sprintf("// Refactoring failed for %s\n// %s", path, err.Error())
			os.WriteFile(convertedPath, []byte(errorContent), 0644)
		} else {
			os.WriteFile(convertedPath, refactoredBytes, 0644)
		}
	}

	// 3. Aggregate and save CSS
	cssByFile := make(map[string]string)
	for _, comp := range allStyledComponents {
		formattedCSS := fmt.Sprintf(".%s {\n%s\n}\n", comp.Name, comp.CSS)
		cssByFile[comp.File] += formattedCSS
	}

	for file, css := range cssByFile {
		relPath, err := filepath.Rel(filepath.Dir(dir), file)
		if err != nil {
			continue
		}
		scssPath := strings.TrimSuffix(relPath, filepath.Ext(relPath)) + ".scss"
		convertedPath := filepath.Join("tmp/converted", scssPath)
		os.MkdirAll(filepath.Dir(convertedPath), 0755)
		os.WriteFile(convertedPath, []byte(css), 0644)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(allStyledComponents)
}

func main() {
	// Serve static UI
	http.Handle("/", http.FileServer(http.Dir("web")))

	// Scan endpoint
	http.HandleFunc("/scan", scanDirHandler)

	// Ensure tmp/converted exists and serve files from it
	os.MkdirAll("tmp/converted", 0755)
	http.Handle("/converted/", http.StripPrefix("/converted/", http.FileServer(http.Dir("tmp/converted"))))

	fmt.Println("🚀 Server running at: http://localhost:3001")
	if err := http.ListenAndServe(":3001", nil); err != nil {
		panic(err)
	}
}
