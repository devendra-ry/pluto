/** Emit a terminal stream event only after the persisted generation work succeeds. */
export async function persistThenEmitTerminal(
    persist: () => Promise<void>,
    emitTerminal: () => void | Promise<void>,
): Promise<void> {
    await persist();
    await emitTerminal();
}
