import { systemCommands } from './system.js';
import { navigationCommands } from './navigation.js';
import { utilityCommands } from './utilities.js';
import { mediaCommands } from './media.js';
import { searchCommands } from './search.js';
import { downloaderCommands } from './downloader.js';
import { groupCommands } from './group.js';
import { gameCommands } from './games.js';
import { animeCommands } from './anime.js';
import { aiCommands } from './ai.js';
import { ownerCommands } from './owner.js';
import { profileCommands } from './profile.js';
import { customCommands } from './custom.js';

export const allCommandCategories = {
    system: systemCommands,
    navigation: navigationCommands,
    utilities: utilityCommands,
    media: mediaCommands,
    search: searchCommands,
    downloader: downloaderCommands,
    group: groupCommands,
    games: gameCommands,
    anime: animeCommands,
    ai: aiCommands,
    owner: ownerCommands,
    profile: profileCommands,
    custom: customCommands
};

// Build flat map of command names and aliases
export const commandMap = new Map();

for (const [category, cmds] of Object.entries(allCommandCategories)) {
    for (const [name, def] of Object.entries(cmds)) {
        const entry = { ...def, name, category };
        commandMap.set(name.toLowerCase(), entry);

        if (Array.isArray(def.aliases)) {
            for (const alias of def.aliases) {
                commandMap.set(alias.toLowerCase(), entry);
            }
        }
    }
}

/**
 * Find command by name or alias.
 */
export function getCommand(cmdName) {
    if (!cmdName) return null;
    return commandMap.get(cmdName.toLowerCase()) || null;
}
