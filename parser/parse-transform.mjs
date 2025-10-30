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

function handleVariableDeclarator(node) {
    if (!node.init || node.init.type !== 'TaggedTemplateExpression') return;

    const tag = node.init.tag;
    let isStyled = false;
    let element = '';

    // styled.div`...`
    if (tag.type === 'MemberExpression' && tag.object.name === 'styled') {
        isStyled = true;
        element = tag.property.name;
    }

    // styled(Component)`...`
    if (tag.type === 'CallExpression' && tag.callee.name === 'styled') {
        isStyled = true;
        element = generate(tag.arguments[0]).code;
    }

    if (isStyled) {
        const name = node.id.name;
        const key = `${filePath}::${name}`;
        if (seen.has(key)) return;
        seen.add(key);

        // Extract CSS contents
        const css = node.init.quasi.quasis.map(q => q.value.raw).join('');

        // Generate placeholder JSX
        const jsxConverted = `<${element} className="${name}">{children}</${element}>`;

        styledComponents.push({
            name,
            css,
            element,
            file: filePath,
            convertedJSX: jsxConverted,
        });

        console.error("Detected styled component:", name);
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
