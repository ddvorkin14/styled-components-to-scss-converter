# Styled Components to SCSS Converter

A tool that scans React/TypeScript projects for styled-components usage and converts them to SCSS files with corresponding component updates. This tool provides a web interface to visualize and preview the conversions.

## Features
![styled-component converter](https://github.com/user-attachments/assets/1bdb22da-082e-425c-b178-2ae7ac7a228e)

- Scans directories for files containing styled-components
- Converts styled-components to SCSS classes
- Generates converted TypeScript/React components using SCSS imports
- Preserves component hierarchy and styling
- Web interface for visualizing conversions
- Side-by-side comparison of original and converted code
- Syntax highlighting for better code readability
- Optional direct write to source for immediate file conversion

## Prerequisites

- Node.js (with npm)
- Go 1.24.2 or higher
- Modern web browser

## Installation

1. Clone the repository:
```bash
git clone https://github.com/ddvorkin14/styled-components-to-scss-converter.git
cd styled-components-to-scss-converter
```

2. Install Node.js dependencies:
```bash
cd parser
npm install
cd ..
```

3. The Go dependencies are managed through go.mod, so they will be installed automatically when you run the application.

## Usage

1. Start the server:
```bash
go run main.go
```

2. Open your web browser and navigate to:
```
http://localhost:3001
```

3. In the web interface:
   - Enter the path to your components directory in the input field
   - (Optional) Check "Write to Source" if you want to write the converted files directly to your source directory
   - Click "Scan" to start the conversion process
   - View the converted SCSS and component files side by side

Note: The "Write to Source" feature allows you to:
- Preview conversions without modifying your source code (default)
- Write converted files directly to your source directory when checked
- Safely experiment with conversions before committing to changes

## Project Structure

- `/parser/` - Node.js scripts for parsing and transforming components
  - `parse.js` - Extracts styled-components from source files
  - `parse-transform.mjs` - Transforms styled-components to SCSS
  - `refactor-component.mjs` - Refactors components to use SCSS classes

- `/web/` - Web interface files
  - `index.html` - Main web interface with code preview

- `/tmp/` - Generated files directory
  - `styled-info.json` - Temporary storage for styled-components data
  - `/converted/` - Output directory for converted files

## How It Works

1. The tool scans the specified directory for files containing styled-components
2. It parses the files using Babel to extract styled-components definitions
3. Converts the styled-components CSS to SCSS format
4. Generates new component files that use SCSS classes instead of styled-components
5. Creates corresponding SCSS files with the converted styles
6. Provides a web interface to preview and compare the conversions
7. Optionally writes converted files directly to your source directory when enabled

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC License
