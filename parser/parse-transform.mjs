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
if (!filePath) {
    console.error("Usage: node parse-transform.mjs <file>");
    process.exit(1);
}

let code = '';
try {
    code = fs.readFileSync(filePath, 'utf-8');
} catch (err) {
    console.error("Cannot read file:", filePath, err.message);
    process.stdout.write(JSON.stringify([]));
    process.exit(0);
}

console.error("Parsing file:", filePath);

let ast;
try {
    ast = parse(code, {
        sourceType: 'module',
        plugins: [
            'typescript',
            'jsx',
            'classProperties',
            'optionalChaining',
            'nullishCoalescingOperator',
            'decorators-legacy',
        ]
    });
} catch (err) {
    console.error("Parser failed:", err.message);
    process.stdout.write(JSON.stringify([]));
    process.exit(0);
}

const styledComponents = [];
const seen = new Set();

// Track imports and their sources
const importMap = new Map(); // name -> source
const rosettaImports = new Set();

// First pass to collect all imports
traverse(ast, {
    ImportDeclaration(path) {
        const source = path.node.source.value;
        path.node.specifiers.forEach(spec => {
            if (spec.type === 'ImportSpecifier') {
                importMap.set(spec.local.name, source);
                if (source === '@joinhandshake/rosetta') {
                    rosettaImports.add(spec.local.name);
                    console.error(`Found Rosetta import: ${spec.local.name}`);
                }
            }
        });
    }
});

function collectInterpolatedComponents(quasi) {
    const components = new Set();
    quasi.expressions.forEach(expr => {
        if (expr.type === 'Identifier' && rosettaImports.has(expr.name)) {
            components.add(expr.name);
            console.error(`Found interpolated Rosetta component: ${expr.name}`);
        }
    });
    return components;
}

function handleVariableDeclarator(node) {
    console.error('\nAnalyzing variable declarator:', node.id.name);
    
    if (!node.init || node.init.type !== 'TaggedTemplateExpression') {
        console.error('Not a styled-component (not a tagged template)');
        return;
    }

    const tag = node.init.tag;
    console.error('Tag type:', tag.type);
    if (tag.type === 'CallExpression') {
        console.error('Call expression args:', generate(tag.arguments[0]).code);
    }
    
    let isStyled = false;
    let element = '';
    let isRosetta = false;
    let importPath = '';
    let interpolatedComponents = new Set();

    // styled.div`...`
    if (tag.type === 'MemberExpression' && tag.object.name === 'styled') {
        isStyled = true;
        element = tag.property.name;
    }

    // styled(Component)`...`
    if (tag.type === 'CallExpression' && tag.callee.name === 'styled') {
        isStyled = true;
        const componentArg = tag.arguments[0];
        element = generate(componentArg).code;
        
        console.error('Component argument:', element);
        console.error('Is in rosettaImports?', rosettaImports.has(componentArg.name));
        console.error('Current rosettaImports:', [...rosettaImports]);
        
        // Check if it's a Rosetta component
        if (componentArg.type === 'Identifier' && rosettaImports.has(componentArg.name)) {
            isRosetta = true;
            importPath = '@joinhandshake/rosetta';
            element = componentArg.name;
            console.error(`Found Rosetta styled component: ${componentArg.name}`);
        }
    }

    if (isStyled) {
        const name = node.id.name;
        const key = `${filePath}::${name}`;
        if (seen.has(key)) return;
        seen.add(key);

        // Extract CSS contents
        const css = node.init.quasi.quasis.map(q => q.value.raw).join('');
        
        // Collect any interpolated Rosetta components
        interpolatedComponents = collectInterpolatedComponents(node.init.quasi);

        // Generate JSX based on component type
        let jsxConverted;
        if (isRosetta) {
            jsxConverted = `<${element} className="${name}">{children}</${element}>`;
        } else {
            jsxConverted = `<${element} className="${name}">{children}</${element}>`;
        }

        const usedRosettaComponents = new Set([
            ...(isRosetta ? [element] : []),
            ...interpolatedComponents
        ]);

        styledComponents.push({
            name,
            css,
            element,
            file: filePath,
            convertedJSX: jsxConverted,
            isRosetta,
            importPath: '@joinhandshake/rosetta',
            rosettaComponents: Array.from(usedRosettaComponents)
        });

        console.error("Detected styled component:", name, isRosetta ? "(Rosetta)" : "");
    }
}

traverse(ast, {
    VariableDeclarator({ node }) {
        handleVariableDeclarator(node);
    },
    ExportNamedDeclaration({ node }) {
        // export const X = styled.div``
        if (node.declaration && node.declaration.type === 'VariableDeclaration') {
            for (const decl of node.declaration.declarations) {
                handleVariableDeclarator(decl);
            }
        }
    }
});

console.error("Final styledComponents array:", JSON.stringify(styledComponents, null, 2));
process.stdout.write(JSON.stringify(styledComponents));
