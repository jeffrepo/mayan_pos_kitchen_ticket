import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";

const addon = fileURLToPath(new URL("../", import.meta.url));
const odoo = process.env.ODOO_SOURCE_DIR;
assert.ok(odoo, "Set ODOO_SOURCE_DIR to an Odoo 18 source checkout (see README.md).");

// Execute the actual Odoo methods, without starting its browser app or services.
// Only imports and export declarations are removed; method bodies are unchanged.
function evaluate(context, filename, exports = []) {
    const source = readFileSync(filename, "utf8")
        .replace(/^import\b[\s\S]*?;\s*$/gm, "")
        .replace(/^export\s+(?=class |function |const |let )/gm, "");
    return vm.runInContext(`(() => {\n${source}\nreturn {${exports.join(",")}};\n})()`, context, {
        filename,
    });
}

function runtime({ patched = true } = {}) {
    const context = vm.createContext({
        Reactive: class {},
        registry: { category: () => ({ add() {} }) },
        luxon: { DateTime: { now: () => ({ toFormat: () => "19:49" }) } },
        _t: (text, value) => text.replace("%s", value ?? ""),
        AlertDialog: class {},
        OrderReceipt: class {},
        console: { info() {}, error() {} },
        renderToElement: (template, data) => ({ template, ...JSON.parse(JSON.stringify(data)) }),
    });
    const sources = [
        ["addons/web/static/src/core/utils/patch.js", ["patch"]],
        ["addons/point_of_sale/static/src/app/models/utils/order_change.js", ["changesToOrder"]],
        ["addons/point_of_sale/static/src/app/store/pos_store.js", ["PosStore"]],
    ];
    for (const [path, exports] of sources) {
        Object.assign(context, evaluate(context, join(odoo, path), exports));
    }
    Object.assign(
        context,
        evaluate(context, join(addon, "static/src/utils/kitchen_lines.js"), ["sortKitchenLines"])
    );
    if (patched) {
        evaluate(context, join(addon, "static/src/overrides/pos_store.js"));
    }
    return context;
}

function fixture({ patched = true, printerCategories = [[1, 2]], previous = [] } = {}) {
    const context = runtime({ patched });
    const sample = [
        ["pollo", "FILETE DE PECHUGA DE POLLO TRADICIONAL", 2, ""],
        ["guacamol", "CON GUARNICION DE GUACAMOL", 1, ""],
        ["vegetales", "CON VEGETALES", 1, "asados"],
        ["lomito", "LOMITO TRADICIONAL DE 10 ONZ", 2, "3/4"],
        ["aguacate", "CON GUARNICION DE AGUACATE", 1, ""],
        ["papa", "CON GUARNICION DE PAPA ASADA", 1, ""],
    ];
    const products = new Map();
    const lines = sample.map(([uuid, name, category, note], index) => {
        const product = {
            id: index + 1,
            name,
            display_name: name,
            type: "consu",
            parentPosCategIds: [category],
            pos_categ_ids: [{ id: category, sequence: category }],
        };
        products.set(product.id, product);
        return {
            uuid,
            product_id: product,
            note,
            qty: 1,
            attribute_value_ids: [],
            skip_change: false,
            get_product() { return this.product_id; },
            getNote() { return this.note; },
            get_quantity() { return this.qty; },
            get_full_product_name() { return this.product_id.name; },
            setHasChange() {},
        };
    });
    const order = {
        id: "temporary-order",
        lines,
        config: { name: "MAYAN GOLF - RESTAURANTE", takeaway: true },
        user_id: { name: "MESEROS PRUEBA" },
        table_id: { table_number: 52 },
        tracking_number: "52",
        general_note: "",
        takeaway: false,
        last_order_preparation_change: {
            lines: Object.fromEntries(previous.map((line) => [line.uuid, line])),
            generalNote: "",
            sittingMode: "dine in",
        },
        get_orderlines() { return this.lines; },
        models: { "pos.order.line": { getBy: (_, uuid) => order.lines.find((l) => l.uuid === uuid) } },
    };
    const alerts = [];
    const store = Object.create(context.PosStore.prototype);
    const printers = printerCategories.map((categories) => ({
        config: { product_categories_ids: categories },
        receipts: [],
        async printReceipt(receipt) {
            this.receipts.push(receipt);
            return { successful: true };
        },
    }));
    Object.assign(store, {
        models: { "product.product": { get: (id) => products.get(id) } },
        unwatched: { printers },
        dialog: { add: (_, message) => alerts.push(message) },
    });
    const changes = () => context.changesToOrder(order, false, new Set([1, 2]));
    return { context, store, order, printers, products, alerts, changes };
}

const uuids = (lines) => Array.from(lines, (line) => line.uuid);
const received = (printer) => uuids(printer.receipts[0].changedlines);

test("reproduce el orden por categorías de Odoo y corrige el pedido de la foto", async () => {
    const original = fixture({ patched: false });
    await original.store.printChanges(original.order, original.changes());
    assert.deepEqual(received(original.printers[0]), [
        "guacamol", "vegetales", "aguacate", "papa", "pollo", "lomito",
    ]);
    assert.equal(original.printers[0].receipts.length, 1);

    const fixed = fixture();
    const originalOrder = uuids(fixed.order.lines);
    assert.equal(await fixed.store.printChanges(fixed.order, fixed.changes()), true);
    assert.deepEqual(received(fixed.printers[0]), originalOrder);
    assert.deepEqual(uuids(fixed.order.lines), originalOrder);
    assert.equal(fixed.printers[0].receipts.length, 2);
    assert.strictEqual(fixed.printers[0].receipts[0], fixed.printers[0].receipts[1]);
    const receipt = fixed.printers[0].receipts[0];
    assert.equal(receipt.changedlines[2].note, "asados");
    assert.equal(receipt.changedlines[3].note, "3/4");
    assert.equal(receipt.changes.table_name, 52);
    assert.equal(receipt.changes.employee_name, "MESEROS PRUEBA");
    assert.equal(fixed.alerts.length, 0);
});

test("filtra cada impresora sin romper el orden relativo ni duplicar categorías ajenas", async () => {
    const f = fixture({ printerCategories: [[2], [1], [99]] });
    await f.store.printChanges(f.order, f.changes());
    assert.deepEqual(received(f.printers[0]), ["pollo", "lomito"]);
    assert.deepEqual(received(f.printers[1]), ["guacamol", "vegetales", "aguacate", "papa"]);
    assert.deepEqual(f.printers.map((p) => p.receipts.length), [2, 2, 0]);
});

test("identifica líneas repetidas por UUID y conserva sus notas y cantidades", async () => {
    const f = fixture();
    f.order.lines[3].product_id = f.order.lines[0].product_id;
    f.order.lines[3].qty = 2;
    await f.store.printChanges(f.order, f.changes());
    const lines = f.printers[0].receipts[0].changedlines;
    assert.equal(lines[0].product_id, lines[3].product_id);
    assert.equal(lines[0].note, "");
    assert.equal(lines[3].note, "3/4");
    assert.equal(lines[3].quantity, 2);
    assert.deepEqual(uuids(lines), uuids(f.order.lines));
});

test("no prioriza combos por delante de líneas ingresadas antes", async () => {
    const f = fixture();
    f.order.lines[3].product_id.type = "combo";
    f.order.lines[4].combo_item_id = { id: 7 };
    await f.store.printChanges(f.order, f.changes());
    assert.deepEqual(received(f.printers[0]), uuids(f.order.lines));
});

test("sin cambios no imprime; una cantidad adicional no reimprime el pedido anterior", async () => {
    const f = fixture();
    const sent = f.changes().new;
    f.order.last_order_preparation_change.lines = Object.fromEntries(sent.map((l) => [l.uuid, l]));
    assert.equal(await f.store.printChanges(f.order, f.changes()), false);
    assert.equal(f.printers[0].receipts.length, 0);
    f.order.lines[3].qty = 3;
    await f.store.printChanges(f.order, f.changes());
    assert.equal(f.printers[0].receipts.length, 2);
    assert.deepEqual(received(f.printers[0]), ["lomito"]);
    assert.equal(f.printers[0].receipts[0].changedlines[0].quantity, 2);
});

test("cambios de notas y anulaciones conservan sus secciones y dos copias", async () => {
    const f = fixture();
    const sent = f.changes().new;
    f.order.last_order_preparation_change.lines = Object.fromEntries(sent.map((l) => [l.uuid, l]));
    f.order.lines[3].note = "bien cocido";
    f.order.lines = f.order.lines.filter((line) => !["pollo", "guacamol"].includes(line.uuid));
    await f.store.printChanges(f.order, f.changes());
    const tickets = f.printers[0].receipts;
    assert.equal(tickets.length, 4);
    assert.equal(tickets[0].operational_title, "Note");
    assert.equal(tickets[0].changedlines[0].note, "bien cocido");
    assert.equal(tickets[2].operational_title, "Cancelled");
    assert.deepEqual(uuids(tickets[2].changedlines), ["pollo", "guacamol"]);
    assert.ok(tickets[2].changedlines.every((line) => line.quantity === 1));
});

test("ordena juntas las líneas eliminadas y las reducidas según la comanda previa", async () => {
    const f = fixture();
    f.order.lines[0].qty = 2;
    const sent = f.changes().new;
    f.order.last_order_preparation_change.lines = Object.fromEntries(sent.map((l) => [l.uuid, l]));
    f.order.lines[0].qty = 1;
    f.order.lines = f.order.lines.filter((line) => line.uuid !== "guacamol");
    const changes = f.changes();
    changes.cancelled.reverse();
    await f.store.printChanges(f.order, changes);
    assert.deepEqual(received(f.printers[0]), ["pollo", "guacamol"]);
    assert.equal(f.printers[0].receipts.length, 2);
});

test("una anulación total conserva el orden previo aunque no queden líneas", async () => {
    const f = fixture();
    const sent = f.changes().new;
    f.order.last_order_preparation_change.lines = Object.fromEntries(sent.map((l) => [l.uuid, l]));
    f.order.lines = [];
    await f.store.printChanges(f.order, f.changes());
    assert.deepEqual(received(f.printers[0]), uuids(sent));
    assert.equal(f.printers[0].receipts[0].operational_title, "Cancel");
    assert.equal(f.printers[0].receipts.length, 2);
});

test("las líneas desconocidas conservan su orden y el array recibido no se modifica", () => {
    const f = fixture();
    const changes = [{ uuid: "extra-1" }, { uuid: "lomito" }, { uuid: "extra-2" }, { uuid: "pollo" }];
    const before = JSON.stringify(changes);
    const sorted = f.context.sortKitchenLines(f.order, changes);
    assert.deepEqual(uuids(sorted), ["pollo", "lomito", "extra-1", "extra-2"]);
    assert.equal(JSON.stringify(changes), before);
});

test("envía las copias en secuencia y espera la confirmación de la primera", async () => {
    const f = fixture();
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    f.printers[0].printReceipt = async () => {
        calls++;
        if (calls === 1) await waiting;
        return { successful: true };
    };
    const printing = f.store.printChanges(f.order, f.changes());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    assert.equal(await printing, true);
    assert.equal(calls, 2);
});

for (const failureAt of [1, 2]) {
    for (const throws of [false, true]) {
        test(`fallo en copia ${failureAt} (${throws ? "excepción" : "respuesta"}): avisa y no reintenta`, async () => {
            const f = fixture();
            let calls = 0;
            f.printers[0].printReceipt = async () => {
                calls++;
                if (calls === failureAt) {
                    if (throws) throw new Error("Printer unavailable");
                    return { successful: false };
                }
                return { successful: true };
            };
            assert.equal(await f.store.printChanges(f.order, f.changes()), false);
            assert.equal(calls, failureAt);
            assert.equal(f.alerts.length, 1);
            assert.equal(f.alerts[0].title, "Printing failed");
        });
    }
}

test("conserva el aviso de cambio de modalidad y los mensajes generales", async () => {
    const f = fixture();
    const changes = f.changes();
    changes.generalNote = "Enviar junto";
    changes.modeUpdate = true;
    f.order.general_note = "Enviar junto";
    await f.store.printChanges(f.order, changes);
    const tickets = f.printers[0].receipts;
    assert.equal(tickets.length, 4);
    assert.equal(tickets[0].changes.diningModeUpdate, true);
    assert.equal(tickets[0].changes.order_note, "Enviar junto");
    assert.equal(tickets[2].operational_title, "Message");
    assert.deepEqual(tickets[2].changedlines, []);
});

test("el recibo de cliente mantiene una sola impresión", async () => {
    const f = fixture();
    let calls = 0;
    f.store.printer = { print: async () => { calls++; return true; } };
    f.store.env = { utils: { formatCurrency: String } };
    f.store.orderExportForPrinting = () => ({});
    f.order.nb_print = 0;
    assert.equal(await f.store.printReceipt({ order: f.order }), true);
    assert.equal(calls, 1);
    assert.equal(f.order.nb_print, 1);
});
