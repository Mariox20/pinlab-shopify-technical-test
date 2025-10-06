
# Prueba Técnica Pinlab - Integraciones Shopify

Solución completa para la prueba técnica de desarrollo de integraciones con Shopify.

## 📋 Contenido

Este repositorio contiene la implementación de tres componentes:

1. **Barra de Envío Gratis** - Section para Shopify con barra de progreso
2. **Importador Masivo de Productos** - Script para carga de productos desde CSV
3. **Actualizador de Inventario** - Script para actualización de stock en múltiples ubicaciones

## 📁 Estructura del Proyecto
prueba-pinlab/

├── examples/                      # Archivos CSV de ejemplo
#### Component 1: Barra de envío gratis
├── free-shipping-bar/             
│   └── extensions ── shipping-bar ── blocks ── star_rating.liquid      

├── node_modules/                  # Dependencias (generadas automáticamente)

├── reports/                       # Reportes generados por los scripts
##### Components 2 y 3: Scripts de automatización
├── scripts/                       
│   ├── product-upload.js

│   └── inventory-update.js
#### Variables de entorno (no incluido en git)
├── .env        

├── .gitignore

├── package.json

├── package-lock.json

└── README.md                     # Este archivo

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js v18 o superior
- npm o yarn
- Acceso a una tienda Shopify
- Credenciales de API de Shopify (Admin API)

### Instalación

1. **Clona el repositorio:**

git clone https://github.com/Mariox20/pinlab-shopify-technical-test.git

cd pinlab-shopify-technical-test

2. **Instala las dependencias:**
npm install

3. **Configura las variables de entorno:**

## Crea el archivo .env en la raíz del proyecto
cp .env.example .env

## Edita el archivo .env con tus credenciales:

`SHOPIFY_STORE_URL=tu-tienda.myshopify.com`

`SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx`

`SHOPIFY_API_VERSION=2025-10`

## 🔐 Cómo Obtener el Access Token

Ve a Shopify Admin → Settings → Apps and sales channels

Click en Develop apps

Click en Create an app

Nombra tu app (ej: "Pinlab Integration")

Ve a API credentials

### En Admin API access scopes, selecciona:

✅ read_products

✅ write_products

✅ read_inventory

✅ write_inventory

✅ read_locations


Click Save

Click Install app

Copia el Admin API access token → Pégalo en tu .env

⚠️ Importante: Guarda el token de forma segura. Solo se muestra una vez.

# 📦 Componentes
## 1️⃣ Barra de Envío Gratis
Ubicación: free-shipping-bar/

Section de Shopify que muestra una barra de progreso indicando cuánto falta para alcanzar el envío gratis.
Características:

✅ Actualización en tiempo real del carrito

✅ Totalmente configurable desde el editor de temas

✅ Compatible con cart drawer y cart page

✅ Formato de moneda chilena (CLP)

✅ Animaciones suaves

## Instalación:

Ve a tu tema en Shopify Admin → Online Store → Themes

Click en Actions → Edit code

En la carpeta Sections, añade un nuevo archivo

Nombra la section como shipping-bar.liquid

Copia y pega el contenido de \free-shipping-bar\extensions\shipping-bar\blocks\star_rating.liquid  ->  shipping-bar.liquid

Guarda los cambios

## Configuración:

Ve a Customize en tu tema

Click en Add section

Busca y selecciona Barra Envío Gratis

## Configura:

Monto Objetivo: Umbral para envío gratis (ej: 50000)

Texto Antes: ¡Estás a $10.000 de envío gratis! 🚀

Texto Después: ¡Felicidades! Ya tienes envío gratis. 🎉

Ejemplo de funcionamiento:

Threshold: $50.000

Carrito: $21.500

Resultado: "¡Estás a $28.500 de envío gratis! 🚀" (43% completado)


## 2️⃣ Importador Masivo de Productos
Ubicación: scripts/product-upload.js

Script para crear o actualizar productos en Shopify desde un archivo CSV.

Características:

✅ Operación idempotente (no duplica productos)

✅ Actualización por SKU si el producto existe

✅ Creación de productos y variantes

✅ Reporte detallado de operaciones


Formato del CSV:

Archivo de ejemplo: examples/products.csv

handle,title,body_html,price,sku,barcode,option1_name,option1_value,images

test-shirt,Test Shirt,"<p>Nice shirt</p>",19990,TSHIRT001,123456789,color,red,https://www.google.com/url?sa=i&url=https%3A%2F%2Fpapelymas.cl%2Fproducto%2Fpolera-rojo-100-algodon-165gr-m2%2F&psig=AOvVaw1Kws0ZgG5U_IDUKUN88lef&ust=1759546733043000&source=images&cd=vfe&opi=89978449&ved=0CBIQjRxqFwoTCOjErLCEh5ADFQAAAAAdAAAAABAE

test-shirt,Test Shirt,"<p>Nice shirt</p>",19990,TSHIRT002,987654321,color,blue,https://www.dimarsa.cl/media/catalog/product/m/a/marcasgreenlifelisasinbordado-navy2jpeg_1.jpg

test-shirt-2,Test Shirt 2,"<p>Nice shirt</p>",9990,TSHIRT003,987654322,color,beige,https://www.dcshoes.cl/media/catalog/product/l/a/ladyzt04985_dcthz0_1_1.jpg

test-shirt-3,Test Shirt 3,"<p>Nice shirt</p>",9990,TSHIRT004,987654323,color,brown,https://www.kliper.cl/media/catalog/product/l/a/ladyzt05043_dccqt0_aa1.jpg

## Ejecutar el importador
node scripts/product-upload.js

## El reporte se generará en: reports/product-report-YYYY-MM-DD-HHMMSS.csv
Reporte generado:

handle,sku,result,message

test-shirt,TSHIRT001,error,"{""errors"":{""image"":[""Could not download image: [\""/url is not a valid image file type.\""]""]}}"

test-shirt,TSHIRT002,updated_variant,variant 45932126011567 updated

test-shirt-2,TSHIRT003,updated_variant,variant 45937214259375 updated

# 3️⃣ Actualizador de Inventario
Ubicación: scripts/inventory-update.js

Script para actualizar niveles de inventario en múltiples ubicaciones usando GraphQL.

Características:

✅ Usa inventorySetQuantities (GraphQL)

✅ Cantidades absolutas (no relativas)

✅ Creación automática de niveles en ubicaciones inactivas

✅ Reporte detallado con errores

Formato del CSV:
sku,location_name,available

TSHIRT001,Shop location,20

TSHIRT001,Shop Location 2,10

TSHIRT002,Shop Location 3,15

## Ejecutar el actualizador
node scripts/inventory-update.js

# El reporte se generará en: reports/inventory-update-YYYY-MM-DD-HHMMSS.csv

sku,location_name,result,message

TSHIRT001,Shop location,success,Stock set to 20
TSHIRT001,Shop Location 2,error,"Location ""Shop Location 2"" not found or inactive"
TSHIRT002,Shop Location 3,error,"Location ""Shop Location 3"" not found or inactive"

## 📊 Archivos de Ejemplo
La carpeta examples/ contiene archivos CSV de muestra:

products-example.csv - Ejemplo para importación de productos
inventory-example.csv - Ejemplo para actualización de inventario

Puedes duplicar estos archivos y modificarlos con tus propios datos.

## 🚨 Notas Importantes

Requisitos de Permisos
Tu token de API debe tener los siguientes scopes:

write_products

read_products

write_inventory

read_inventory

read_locations

## Environment Variables

To run this project, you will need to add the following environment variables to your .env file

`API_KEY`

`ANOTHER_API_KEY`

