#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const filePath = process.argv[2];
const styledInfoPath = process.argv[3];

if (!filePath || !styledInfoPath) {
    console.error("Usage: node refactor-component.mjs <component-file-to-refactor> <styled-info-json-path>");
    process.exit(1);
}

const code = fs.readFileSync(filePath, 'utf-8');
const styledInfo = JSON.parse(fs.readFileSync(styledInfoPath, 'utf-8'));

const styledComponentMap = new Map();
const rosettaComponents = new Map();
const neededRosettaImports = new Set();

console.error('\nProcessing styled info:', JSON.stringify(styledInfo, null, 2));

console.error('\nProcessing styled components:');
for (const comp of styledInfo) {
    console.error(`\nComponent ${comp.name}:`);
    console.error(`isRosetta=${comp.isRosetta}`);
    console.error(`element=${comp.element}`);
    console.error(`rosettaComponents=${JSON.stringify(comp.rosettaComponents)}`);
    
    // Add all Rosetta components used in this component
    if (comp.rosettaComponents) {
        comp.rosettaComponents.forEach(name => {
            neededRosettaImports.add(name);
            console.error(`Adding needed Rosetta import: ${name}`);
        });
    }
    
    if (comp.isRosetta) {
        rosettaComponents.set(comp.name, {
            element: comp.element,
            importPath: comp.importPath
        });
        neededRosettaImports.add(comp.element);
        console.error(`Added Rosetta component: ${comp.name} -> ${comp.element}`);
    }
    styledComponentMap.set(comp.name, comp.element);
}

const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
});

let styledComponentsImportPath = '';
const importedStyledComponents = new Set();

traverse(ast, {
    // Find imports from './styles'
    ImportDeclaration(path) {
        const source = path.node.source.value;
        if (source.endsWith('/styles') || source.endsWith('/styles.ts')) {
            styledComponentsImportPath = source;
            for (const specifier of path.node.specifiers) {
                if (specifier.type === 'ImportSpecifier') {
                    const importedName = specifier.imported.name;
                    if (styledComponentMap.has(importedName)) {
                        importedStyledComponents.add(importedName);
                    }
                }
            }
        }
    },

    // Transform JSX elements
    JSXOpeningElement(path) {
        const nodeName = path.node.name.name;
        if (importedStyledComponents.has(nodeName)) {
            const originalElement = styledComponentMap.get(nodeName) || 'div';

            // Change the element type
            path.node.name = t.jsxIdentifier(originalElement);

            // Add className attribute using string literal
            const classNameAttr = t.jSXAttribute(
                t.jSXIdentifier('className'),
                t.stringLiteral(nodeName)
            );
            path.node.attributes.push(classNameAttr);
        }
    },
    JSXClosingElement(path) {
        const nodeName = path.node.name.name;
        if (importedStyledComponents.has(nodeName)) {
            const originalElement = styledComponentMap.get(nodeName) || 'div';
            path.node.name = t.jsxIdentifier(originalElement);
        }
    }
});

// Begin traversal for Rosetta imports
traverse(ast, {
    JSXOpeningElement(path) {
        const nodeName = path.node.name.name;
        if (rosettaComponents.has(nodeName)) {
            neededRosettaImports.add(rosettaComponents.get(nodeName).element);
        }
    }
});

// Modify imports
traverse(ast, {
    ImportDeclaration(path) {
        if (path.node.source.value === styledComponentsImportPath) {
            // Remove the entire import declaration for styled components
            path.remove();
        }
    },
    Program: {
        exit(path) {
            // First, process all JSX elements to collect needed Rosetta components
            traverse(path.node, {
                JSXOpeningElement(elemPath) {
                    const elementName = elemPath.node.name.name;
                    console.error(`Found JSX element: ${elementName}`);
                    
                    // Check if this element was a styled component
                    if (styledComponentMap.has(elementName)) {
                        console.error(`${elementName} was a styled component`);
                        // If it's a Rosetta component, add its element to needed imports
                        if (rosettaComponents.has(elementName)) {
                            const element = rosettaComponents.get(elementName).element;
                            neededRosettaImports.add(element);
                            console.error(`Added Rosetta import for ${elementName}: ${element}`);
                        }
                    }
                }
            });

            // Remove old imports (styled components and styles)
            path.node.body = path.node.body.filter(node => 
                node.type !== 'ImportDeclaration' || 
                (node.source.value !== styledComponentsImportPath && 
                 !node.source.value.endsWith('/styles'))
            );

            // First collect existing Rosetta imports
            const existingRosettaImports = new Set();
            const nonRosettaImports = path.node.body.filter(node => {
                if (node.type === 'ImportDeclaration' && node.source.value === '@joinhandshake/rosetta') {
                    // Collect existing imports before removing
                    node.specifiers.forEach(spec => {
                        if (spec.type === 'ImportSpecifier') {
                            existingRosettaImports.add(spec.imported.name);
                            console.error(`Found existing Rosetta import: ${spec.imported.name}`);
                        }
                    });
                    return false; // Remove old Rosetta import
                }
                return true; // Keep non-Rosetta imports
            });

            // Combine existing and new Rosetta imports
            const allRosettaImports = new Set([...existingRosettaImports, ...neededRosettaImports]);
            console.error('Combined Rosetta imports:', [...allRosettaImports]);

            // Update body with non-Rosetta imports
            path.node.body = nonRosettaImports;

            // Add styles.scss import first
            const scssImport = t.importDeclaration([], t.stringLiteral('./styles.scss'));
            path.node.body.unshift(scssImport);

            // Add single consolidated Rosetta import if needed
            if (allRosettaImports.size > 0) {
                const sortedImports = Array.from(allRosettaImports).sort();
                console.error('Adding consolidated Rosetta imports:', sortedImports);
                
                const rosettaImport = t.importDeclaration(
                    sortedImports.map(name => 
                        t.importSpecifier(t.identifier(name), t.identifier(name))
                    ),
                    t.stringLiteral('@joinhandshake/rosetta')
                );
                
                path.node.body.unshift(rosettaImport);
                console.error('Added single consolidated Rosetta import statement');
            }
        }
    }
});


const output = generate(ast, {}, code);
console.log(output.code);
