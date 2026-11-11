import type {CharacterProfile, Message, UserProfile} from '../types';
import {ContextBuilder} from './context';
import {formatActorRecentMessages} from './storyTheater';

/** Split existing context outputs; retrieval and all memory ownership rules remain with their callers. */
export async function buildStoryCharacterContextParts(input: {
    char: CharacterProfile; user: UserProfile; recalled: string; recent: Message[];
    identityName: string; header: string; skipWorldbookIds: Set<string>; realTime: boolean;
}): Promise<{stable: string; live: string}> {
    const {char, user, recalled, recent, identityName, header, skipWorldbookIds, realTime} = input;
    const actor = {...char, memoryPalaceInjection: recalled};
    const timeOptions = {skipTimeAwareness: !realTime || char.timeAwarenessEnabled === false};
    const core = await ContextBuilder.buildCoreContext(actor, user, true, recalled, {
        skipUserProfile: true, skipWorldbookIds, headerOverride: header,
    }, timeOptions, {deferVolatile: true});
    const state = await ContextBuilder.buildVolatileCoreState(actor, {memoryPalaceContext: recalled, timeOptions});
    const carried = formatActorRecentMessages(char, recent, user.name, identityName, {
        includeTimestamps: realTime, preserveFullText: realTime,
    });
    // The carried transcript excludes this theater's mirrors. It changes when the
    // shared transcript changes, rather than on every scene turn like recall/time.
    const stable = [core, carried].filter(text => text.trim()).join('\n');
    return {stable, live: state.trim() ? `${header}\n${state}` : ''};
}
