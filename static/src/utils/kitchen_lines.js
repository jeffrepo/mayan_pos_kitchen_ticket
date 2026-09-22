/** @odoo-module **/

/**
 * Restore the order's line sequence after Odoo groups kitchen changes by category.
 * Match UUIDs, not products: two lines of the same product can have different notes.
 * For deleted lines, use the previous preparation snapshot, where they still exist.
 * Return a new array without changing quantities, notes, or the order itself.
 */
export function sortKitchenLines(order, lines) {
    const currentLines = order.get_orderlines();
    const currentUuids = new Set(currentLines.map((line) => line.uuid));
    const previousLines = Object.values(order.last_order_preparation_change?.lines || {});
    const previousUuids = new Set(previousLines.map((line) => line.uuid));
    const hasDeletedLines = lines.some(
        (line) => !currentUuids.has(line.uuid) && previousUuids.has(line.uuid)
    );
    const referenceLines = hasDeletedLines
        ? [...previousLines, ...currentLines]
        : currentLines;

    const positions = new Map();
    for (const line of referenceLines) {
        if (line.uuid && !positions.has(line.uuid)) {
            positions.set(line.uuid, positions.size);
        }
    }
    // Keep unknown lines at the end, in their existing relative order.
    const fallback = positions.size;
    return [...lines].sort(
        (left, right) =>
            (positions.get(left.uuid) ?? fallback) - (positions.get(right.uuid) ?? fallback)
    );
}
