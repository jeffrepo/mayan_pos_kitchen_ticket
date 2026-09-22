/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { sortKitchenLines } from "@mayan_pos_kitchen_ticket/utils/kitchen_lines";

const KITCHEN_COPIES = 2;

patch(PosStore.prototype, {
    async getRenderedReceipt(order, title, lines, fullReceipt = false, diningModeUpdate) {
        // At this point Odoo has already selected this printer's product categories.
        return super.getRenderedReceipt(
            order,
            title,
            sortKitchenLines(order, lines),
            fullReceipt,
            diningModeUpdate
        );
    },

    async printReceipts(order, printer, title, lines, fullReceipt = false, diningModeUpdate) {
        // Render once so both copies have identical lines, notes, and timestamp.
        // This is the kitchen route; customer receipts use printReceipt (singular).
        const receipt = await this.getRenderedReceipt(
            order,
            title,
            lines,
            fullReceipt,
            diningModeUpdate
        );
        for (let copy = 0; copy < KITCHEN_COPIES; copy++) {
            try {
                const result = await printer.printReceipt(receipt);
                if (!result?.successful) {
                    return false;
                }
            } catch (error) {
                console.error("Mayan: kitchen receipt printing failed", error);
                // Let Odoo's printChanges show its standard printing-error dialog.
                return false;
            }
        }
        return true;
    },
});
