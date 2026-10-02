import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const CONTRACTS = [
    {
        name: 'start_chat_with_message',
        replacements: [
            ['p_reasoning_effort: string', 'p_reasoning_effort: string | null'],
            ['p_system_prompt: string', 'p_system_prompt: string | null'],
            ['p_thread_id?: string', 'p_thread_id?: string | null'],
        ],
    },
    {
        name: 'soft_delete_messages',
        replacements: [['p_anchor_message_id?: string', 'p_anchor_message_id?: string | null']],
    },
    {
        name: 'claim_pending_generation_job',
        replacements: [
            ['p_user_message_id?: string', 'p_user_message_id?: string | null'],
            ['reasoning_effort: string', 'reasoning_effort: string | null'],
            ['system_prompt: string', 'system_prompt: string | null'],
        ],
    },
    {
        name: 'attachment_path_thread_id',
        replacements: [['Returns: string', 'Returns: string | null']],
    },
];

const GENERATED_COMMENT = [
    '    // Refine nullable RPC contracts from SQL defaults and return definitions.',
    '    // Supabase CLI type generation does not retain this PostgreSQL nullability.',
].join('\n');

function findMatchingBrace(source, openingIndex) {
    let depth = 0;
    let state = 'code';
    let escaped = false;

    for (let index = openingIndex; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];

        if (state === 'line-comment') {
            if (character === '\n') state = 'code';
            continue;
        }
        if (state === 'block-comment') {
            if (character === '*' && next === '/') {
                state = 'code';
                index += 1;
            }
            continue;
        }
        if (state === 'single' || state === 'double' || state === 'template') {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (character === '\\') {
                escaped = true;
                continue;
            }
            if ((state === 'single' && character === "'")
                || (state === 'double' && character === '"')
                || (state === 'template' && character === '`')) state = 'code';
            continue;
        }

        if (character === '/' && next === '/') {
            state = 'line-comment';
            index += 1;
        } else if (character === '/' && next === '*') {
            state = 'block-comment';
            index += 1;
        } else if (character === "'") {
            state = 'single';
        } else if (character === '"') {
            state = 'double';
        } else if (character === '`') {
            state = 'template';
        } else if (character === '{') {
            depth += 1;
        } else if (character === '}') {
            depth -= 1;
            if (depth === 0) return index;
            if (depth < 0) break;
        }
    }

    throw new Error('Generated database types are truncated or contain unbalanced braces.');
}

function locateFunctionBlock(source, functionsStart, functionsEnd, functionName) {
    const functionsBody = source.slice(functionsStart, functionsEnd);
    const property = new RegExp(`(?:^|\\n)[\\t ]*${functionName}:[\\t ]*\\{`, 'g');
    const matches = [...functionsBody.matchAll(property)];
    if (matches.length !== 1) {
        throw new Error(`Generated database types must contain exactly one ${functionName} RPC definition.`);
    }

    const match = matches[0];
    const openingIndex = functionsStart + match.index + match[0].lastIndexOf('{');
    return { start: openingIndex, end: findMatchingBrace(source, openingIndex) };
}

function replaceContract(block, functionName, original, replacement) {
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exact = new RegExp(`(?<![\\w$])${escaped}(?:\\s*\\|\\s*null)?(?![\\w$])(?!\\s*\\|)`, 'g');
    const matches = [...block.matchAll(exact)];
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one '${original}' contract in ${functionName}; found ${matches.length}.`);
    }
    return block.replace(exact, replacement);
}

function validateGeneratedSource(source) {
    if (typeof source !== 'string' || source.trim().length < 100) {
        throw new Error('Supabase returned empty or incomplete TypeScript types.');
    }

    const databaseDeclaration = /export\s+type\s+Database\s*=\s*\{/g.exec(source);
    if (!databaseDeclaration) throw new Error('Generated output is missing the Database type declaration.');
    const databaseOpen = source.indexOf('{', databaseDeclaration.index);
    findMatchingBrace(source, databaseOpen);

    const functions = /\bFunctions\s*:\s*\{/g.exec(source);
    if (!functions) throw new Error('Generated output is missing Database.public.Functions.');
    const functionsOpen = source.indexOf('{', functions.index);
    const functionsEnd = findMatchingBrace(source, functionsOpen);
    return { functionsStart: functionsOpen + 1, functionsEnd };
}

/** Restore the nullable RPC contracts present in SQL but omitted by CLI metadata. */
export function refineDatabaseTypeContracts(generatedSource) {
    validateGeneratedSource(generatedSource);
    let output = generatedSource;

    for (const contract of CONTRACTS) {
        const { functionsStart, functionsEnd } = validateGeneratedSource(output);
        const { start, end } = locateFunctionBlock(output, functionsStart, functionsEnd, contract.name);
        let block = output.slice(start, end + 1);
        for (const [original, replacement] of contract.replacements) {
            block = replaceContract(block, contract.name, original, replacement);
        }
        output = `${output.slice(0, start)}${block}${output.slice(end + 1)}`;
    }

    if (!output.includes('Refine nullable RPC contracts from SQL defaults')) {
        const updatedFunctions = /\bFunctions\s*:\s*\{/g.exec(output);
        if (!updatedFunctions) throw new Error('Could not mark refined database RPC contracts.');
        const lineStart = output.lastIndexOf('\n', updatedFunctions.index) + 1;
        output = `${output.slice(0, lineStart)}${GENERATED_COMMENT}\n${output.slice(lineStart)}`;
    }

    validateGeneratedSource(output);
    return output.endsWith('\n') ? output : `${output}\n`;
}

/** Validate first, then atomically replace the target with a same-directory temp file. */
export async function writeDatabaseTypesAtomically(targetPath, generatedSource) {
    const refinedSource = refineDatabaseTypeContracts(generatedSource);
    const directory = dirname(targetPath);
    await mkdir(directory, { recursive: true });

    const temporaryPath = join(directory, `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporaryPath, refinedSource, { encoding: 'utf8', flag: 'wx' });
        await rename(temporaryPath, targetPath);
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
