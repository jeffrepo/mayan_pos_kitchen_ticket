{
    "name": "Mayan POS - Comandas de cocina",
    "summary": "Comandas en el orden del pedido y dos copias por impresora",
    "version": "18.0.1.0.0",
    "category": "Sales/Point of Sale",
    "author": "Mayan Golf",
    "license": "LGPL-3",
    "depends": ["point_of_sale", "pos_restaurant"],
    "assets": {
        "point_of_sale._assets_pos": [
            "mayan_pos_kitchen_ticket/static/src/utils/kitchen_lines.js",
            "mayan_pos_kitchen_ticket/static/src/overrides/pos_store.js",
        ],
    },
    "application": False,
    "installable": True,
}
