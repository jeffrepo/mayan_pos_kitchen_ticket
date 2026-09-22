# Mayan POS - Comandas de cocina

Nombre técnico: `mayan_pos_kitchen_ticket`.

Versión: `18.0.1.0.0` para Odoo 18.

Addon independiente del módulo `mayan_customer_statement`. Su carpeta puede
copiarse a otro repositorio sin llevarse los archivos de estados de cuenta.

## Comportamiento

Al enviar una comanda con **Orden**:

- Los productos conservan la secuencia de las líneas del pedido, sin agruparse
  por categoría. Cada nota permanece junto a su línea.
- Cada impresora de preparación recibe **dos copias** consecutivas del mismo
  ticket, con los productos que le corresponden según sus categorías.
- Las comandas posteriores siguen incluyendo únicamente los cambios calculados
  por Odoo. Las anulaciones y los cambios de notas también salen en dos copias.
- Si falla una copia, se detiene la impresión de ese ticket y Odoo muestra su
  aviso de error. No se reenvía automáticamente todo el pedido.
- Los recibos del cliente y las facturas conservan su impresión habitual.

Ejemplo basado en el pedido de Mayan:

1. Filete de pechuga de pollo tradicional.
2. Con guarnición de guacamol.
3. Con vegetales — nota: «asados».
4. Lomito tradicional de 10 onz — nota: «3/4».
5. Con guarnición de aguacate.
6. Con guarnición de papa asada.

Esta versión aplica automáticamente a todas las impresoras de preparación del
POS donde se carga el addon. No agrega ajustes ni requiere migraciones de datos.
Respeta las líneas existentes: si Odoo fusionó unidades del mismo producto en una
sola línea, imprime esa línea con su cantidad; no reconstruye clics individuales.
La secuencia es la de las líneas del pedido. Si se activa el ajuste nativo para
ordenar el carrito por categoría, la visualización del carrito puede diferir.

## Instalación como módulo separado

1. Copiar **esta carpeta completa** a `<ruta_addons>/mayan_pos_kitchen_ticket`.
   Debe quedar `mayan_pos_kitchen_ticket/__manifest__.py` en esa ruta.
   No instalarla anidada dentro de `mayan_customer_statement`.
2. Reiniciar Odoo y actualizar la lista de aplicaciones.
3. Buscar **Mayan POS - Comandas de cocina**. Si no aparece, quitar el filtro
   **Aplicaciones**, porque es una extensión del POS.
4. Instalar el módulo en una base de pruebas de Odoo 18 con Restaurante instalado.
5. Salir de la interfaz del POS y volver a abrirla en cada terminal para cargar
   los recursos nuevos. Recargar sin caché si el navegador conserva los anteriores.
6. Validar las impresiones físicas antes de instalarlo en producción.

Para actualizar una instalación existente:

```bash
odoo-bin -d NOMBRE_BD -u mayan_pos_kitchen_ticket --stop-after-init
```

## Prueba funcional

1. Ingresar los seis productos del ejemplo en esa secuencia y agregar las notas.
2. Pulsar **Orden** una sola vez: deben salir dos comandas iguales y ordenadas.
3. Volver a pulsar **Orden** sin cambios: no deben salir nuevas comandas.
4. Agregar un producto: deben salir dos tickets del cambio, sin repetir los
   productos enviados previamente.
5. Cambiar una nota y anular una línea ya enviada: revisar las dos copias de cada
   aviso de cambio/anulación y sus cantidades.
6. Si hay cocina y bar, comprobar que cada impresora recibe solamente sus productos.
7. Imprimir un recibo de cliente: debe conservar el número habitual de copias.
8. Simular un fallo de impresora: debe aparecer el aviso de Odoo. Revisar qué
   copias salieron antes de usar una reimpresión manual.

La confirmación es la respuesta del controlador de impresión. Un problema físico
posterior (papel, corte o desconexión) debe comprobarse en la impresora.
Se mantiene el seguimiento de envíos de Odoo 18: un fallo no introduce una cola
persistente ni garantiza que volver a pulsar **Orden** reintente el ticket.

## Desarrollo y validación

La corrección se aplica en `PosStore.getRenderedReceipt`, después del filtro por
categorías de cada impresora y del ordenamiento estándar. Las líneas se identifican
por UUID, de modo que dos productos iguales con notas distintas no se confunden.
Las líneas eliminadas usan el orden del último registro de preparación disponible.
`PosStore.printReceipts` renderiza una sola vez y realiza dos envíos secuenciales.
El módulo no vuelve a ejecutar el envío del pedido ni su actualización de estado.

Las pruebas usan las funciones reales de la rama oficial 18.0 con dobles para
el renderizado, los servicios y la impresora. Requieren Node.js 20 o posterior
y una copia del código de Odoo 18; no requieren una base de datos:

```bash
ODOO_SOURCE_DIR=/ruta/al/codigo/odoo \
  node --test tests/kitchen_ticket.test.mjs
```

Esto verifica la lógica JavaScript; no sustituye la instalación en Odoo ni la
prueba con el modelo de impresora de Mayan.

Referencias oficiales:

- [Flujo de impresión del POS en Odoo 18](https://github.com/odoo/odoo/blob/18.0/addons/point_of_sale/static/src/app/store/pos_store.js).
- [Cálculo de cambios del pedido](https://github.com/odoo/odoo/blob/18.0/addons/point_of_sale/static/src/app/models/utils/order_change.js).
- [Utilidad de extensiones de Odoo](https://github.com/odoo/odoo/blob/18.0/addons/web/static/src/core/utils/patch.js).
