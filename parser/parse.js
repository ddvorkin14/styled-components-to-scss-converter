#!/usr/bin/env node
import fs from 'fs';
import { parse } from '@babel/parser';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const traverse = require('@babel/traverse').default;

const filePath = process.argv[2];
if (!filePath) {
    console.error("Usage: node parse.js <path-to-file>");
    process.exit(1);
}

const code = fs.readFileSync(filePath, 'utf8');

const ast = parse(code, {
    sourceType: 'module',
    plugins: [
        'jsx',
        'typescript',
        'classProperties',
        'optionalChaining',
        'nullishCoalescingOperator',
    ],
});

const styledComponents = [];

traverse(ast, {
    VariableDeclarator({ node }) {
        if (
            node.init?.type === 'TaggedTemplateExpression' &&
            (
                node.init.tag.type === 'MemberExpression' && node.init.tag.object.name === 'styled' ||
                node.init.tag.type === 'CallExpression' && node.init.tag.callee.name === 'styled'
            )
        ) {
            const css = node.init.quasi.quasis.map(q => q.value.cooked).join('\n');
            styledComponents.push({
                name: node.id.name,
                css,
                file: filePath
            });
        }
    }
});

console.log(JSON.stringify(styledComponents, null, 2));
