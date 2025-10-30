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
	IsRosetta    bool   `json:"isRosetta"`    // Is this a Rosetta component
	ImportPath   string `json:"importPath"`    // The import path for Rosetta components
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

	var comps []StyledComponent
	if err := json.Unmarshal(outBytes, &comps); err != nil {
		fmt.Printf("JSON unmarshal error for %s:\n%s\n", path, string(outBytes))
		return nil, err
	}

	return comps, nil
}

// writeToPath writes content to both temp and source directories
func writeToPath(targetPath, content string, writeToSource bool, sourceDir string) error {
	// Clean up paths
	targetPath = strings.TrimPrefix(targetPath, "/")
	
	// First write to tmp directory
	tmpPath := filepath.Join("tmp/converted", targetPath)
	tmpPath = strings.ReplaceAll(tmpPath, "\\", "/")
	fmt.Printf("Writing to tmp path: %s\n", tmpPath)
	os.MkdirAll(filepath.Dir(tmpPath), 0755)
	if err := os.WriteFile(tmpPath, []byte(content), 0644); err != nil {
		fmt.Printf("Error writing to tmp path: %s - %v\n", tmpPath, err)
		return err
	}

	// If writeToSource is true, also write to source directory
	if writeToSource && sourceDir != "" {
		// For source path, we need to write relative to the original source directory
		sourcePath := filepath.Join(sourceDir, filepath.Base(targetPath))
		sourcePath = strings.ReplaceAll(sourcePath, "\\", "/")
		fmt.Printf("Writing to source path: %s\n", sourcePath)
		if err := os.MkdirAll(filepath.Dir(sourcePath), 0755); err != nil {
			fmt.Printf("Error creating source directory: %s - %v\n", filepath.Dir(sourcePath), err)
			return err
		}
		if err := os.WriteFile(sourcePath, []byte(content), 0644); err != nil {
			fmt.Printf("Error writing to source path: %s - %v\n", sourcePath, err)
			return err
		}
		fmt.Printf("Successfully wrote to source path: %s\n", sourcePath)
	} else {
		fmt.Printf("Skipping source write. writeToSource: %v, sourceDir: %s\n", writeToSource, sourceDir)
	}
	return nil
}

func saveConverted(comp StyledComponent, scanDir string, writeToSource bool) {
	// Find the path segment starting from 'components'
	idx := strings.Index(comp.File, "/components/")
	if idx == -1 {
		// fallback to scanDir relative
		idx = len(scanDir) + 1
	}
	relPath := comp.File[idx+1:] // remove the leading slash before 'components'
	relPath = strings.TrimSuffix(relPath, filepath.Ext(relPath)) + ".scss-converted.tsx"

	content := fmt.Sprintf(`// Converted %s
import './%s.scss';

export const %sConverted = () => {
  return %s;
};
`, comp.Name, comp.Name, comp.Name, comp.ConvertedJSX)

	writeToPath(relPath, content, writeToSource, scanDir)
}

func saveEmptyConverted(filePath, scanDir string, writeToSource bool) {
	// Find the path segment starting from 'components'
	idx := strings.Index(filePath, "/components/")
	if idx == -1 {
		idx = len(scanDir) + 1
	}
	relPath := filePath[idx+1:]
	relPath = strings.TrimSuffix(relPath, filepath.Ext(relPath)) + ".scss-converted.tsx"

	content := fmt.Sprintf(`// No styled-components found in %s
export const EmptyConverted = () => {
    return <div>Placeholder for %s</div>;
};
`, filepath.Base(filePath), filepath.Base(filePath))

	writeToPath(relPath, content, writeToSource, scanDir)
}

// Scan handler
func scanDirHandler(w http.ResponseWriter, r *http.Request) {
	dir := r.URL.Query().Get("dir")
	if dir == "" {
		http.Error(w, "missing dir parameter", http.StatusBadRequest)
		return
	}
	
	// Get writeToSource parameter from query string
	writeToSourceStr := r.URL.Query().Get("writeToSource")
	writeToSource := writeToSourceStr == "true"
	
	// Store the original source directory if we're not in tmp/converted
	sourceDir := dir
	if strings.HasPrefix(dir, "tmp/converted") {
		sourceDir = strings.TrimPrefix(dir, "tmp/converted/")
		writeToSource = false // Don't write back to source when viewing converted files
	}
	
	fmt.Printf("scanDirHandler called with dir: %s, sourceDir: %s, writeToSource: %v, writeToSourceStr: %s\n", 
		dir, sourceDir, writeToSource, writeToSourceStr)

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
			relPath, _ := filepath.Rel(filepath.Dir(dir), path)
			relPath = strings.TrimSuffix(relPath, filepath.Ext(relPath)) + ".scss-converted.tsx"
			writeToPath(relPath, errorContent, writeToSource, dir)
		} else {
			relPath, _ := filepath.Rel(filepath.Dir(dir), path)
			relPath = strings.TrimSuffix(relPath, filepath.Ext(relPath)) + ".scss-converted.tsx"
			writeToPath(relPath, string(refactoredBytes), writeToSource, dir)
		}
	}

	// 3. Aggregate and save CSS
	cssByFile := make(map[string]string)
	for _, comp := range allStyledComponents {
		// Clean up CSS and ensure consistent indentation
		css := strings.TrimSpace(comp.CSS)
		
		// Fix indentation for each line
		lines := strings.Split(css, "\n")
		var formattedLines []string
		nestLevel := 0
		
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" {
				// Count closing braces at the start of the line
				if strings.HasPrefix(trimmed, "}") {
					nestLevel--
				}
				
				// Add proper indentation based on nesting level
				indent := strings.Repeat("  ", nestLevel+1)
				formattedLines = append(formattedLines, indent+trimmed)
				
				// Count opening braces at the end of the line
				if strings.HasSuffix(trimmed, "{") {
					nestLevel++
				}
			}
		}
		css = strings.Join(formattedLines, "\n")
		
		formattedCSS := fmt.Sprintf(".%s {\n%s\n}\n\n", comp.Name, css)
		cssByFile[comp.File] += formattedCSS
	}

	for file, css := range cssByFile {
		relPath, err := filepath.Rel(filepath.Dir(dir), file)
		if err != nil {
			continue
		}
		scssPath := strings.TrimSuffix(relPath, filepath.Ext(relPath)) + ".scss"
		writeToPath(scssPath, css, writeToSource, dir)
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
