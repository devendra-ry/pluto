import { characterEntities } from 'character-entities';

// Turbopack resolves the decoder's browser export in workers too. That export
// creates a DOM element at module load. Use the package's equivalent lookup
// algorithm so Markdown entities work in both workers and browser fallbacks.
export function decodeNamedCharacterReference(value: string): string | false {
    return Object.hasOwn(characterEntities, value) ? characterEntities[value]! : false;
}
