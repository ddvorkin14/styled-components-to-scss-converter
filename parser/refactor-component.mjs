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
for (const comp of styledInfo) {
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

            // Add className attribute
            const classNameAttr = t.jSXAttribute(
                t.jSXIdentifier('className'),
                t.jSXExpressionContainer(t.stringLiteral(nodeName))
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
            // Add 'import ./styles.scss'
            const scssImport = t.importDeclaration([], t.stringLiteral('./styles.scss'));
            path.node.body.unshift(scssImport);
        }
    }
});


const output = generate(ast, {}, code);
console.log(output.code);
