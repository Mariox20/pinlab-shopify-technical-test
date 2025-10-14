import fs from "fs";
import path from "path";
import csv from "csv-parser";
import axios from "axios";
import { createObjectCsvWriter } from "csv-writer";
import dotenv from "dotenv";

dotenv.config();

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

if (!STORE || !TOKEN) {
  console.error("Missing SHOPIFY_STORE or SHOPIFY_TOKEN in .env");
  process.exit(1);
}

const GRAPHQL_URL = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;
const REST_BASE_URL = `https://${STORE}/admin/api/${API_VERSION}`;

const axiosInstance = axios.create({
  baseURL: GRAPHQL_URL,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json",
  },
  timeout: 20000,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readCsv = (filePath) =>
  new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => rows.push(data))
      .on("end", () => resolve(rows))
      .on("error", (err) => reject(err));
  });

// Buscar producto por SKU usando REST API
const findProductBySKU = async (sku) => {
  try {
    const url = `${REST_BASE_URL}/products.json?fields=id,variants&limit=250`;
    const res = await axios.get(url, {
      headers: { "X-Shopify-Access-Token": TOKEN },
    });
    
    for (const product of res.data.products || []) {
      const variant = product.variants.find((v) => v.sku === sku);
      if (variant) {
        return { product, variant };
      }
    }
    return null;
  } catch (err) {
    console.error(`Error searching product by SKU ${sku}:`, err.message);
    return null;
  }
};

// Obtener ubicaciones mediante GraphQL (incluye activas e inactivas)
const getLocationByName = async (locationName) => {
  const query = `
    query {
      locations(first: 50, includeLegacy: true, includeInactive: true) {
        edges {
          node {
            id
            name
            isActive
          }
        }
      }
    }
  `;
  
  try {
    const res = await axiosInstance.post("", { query });
    const locations = res.data.data.locations.edges.map((e) => e.node);
    const location = locations.find((loc) => 
      loc.name.toLowerCase().trim() === locationName.toLowerCase().trim()
    );
    return location || null;
  } catch (err) {
    console.error("Error fetching locations:", err.message);
    return null;
  }
};

// Activar nivel de inventario usando REST API (necesario antes de usar GraphQL)
const connectInventoryToLocation = async (inventoryItemId, locationId) => {
  try {
    const numericInventoryItemId = inventoryItemId.split('/').pop();
    const numericLocationId = locationId.split('/').pop();
    
    const url = `${REST_BASE_URL}/inventory_levels/connect.json`;
    const res = await axios.post(
      url,
      {
        inventory_item_id: parseInt(numericInventoryItemId, 10),
        location_id: parseInt(numericLocationId, 10),
      },
      {
        headers: { 
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        },
      }
    );
    return { success: true, data: res.data };
  } catch (err) {
    // Si ya está conectado, no es un error
    if (err?.response?.data?.errors?.base?.includes("already exists")) {
      return { success: true, alreadyExists: true };
    }
    console.error("Error connecting inventory:", err?.response?.data || err.message);
    return { success: false, error: err?.response?.data || err.message };
  }
};

// Obtener el nivel de inventario actual usando GraphQL
const getInventoryLevel = async (inventoryItemId, locationId) => {
  const query = `
    query getInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
      inventoryLevel(inventoryItemId: $inventoryItemId, locationId: $locationId) {
        id
        available
        quantities(names: ["available"]) {
          name
          quantity
        }
      }
    }
  `;

  const variables = { inventoryItemId, locationId };
  
  try {
    const res = await axiosInstance.post("", { query, variables });
    return res.data.data.inventoryLevel;
  } catch (err) {
    return null;
  }
};

// Actualizar inventario usando inventorySetQuantities (GraphQL)
const setInventoryGraphQL = async (inventoryItemId, locationId, available) => {
  const mutation = `
    mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          id
          createdAt
          reason
          changes {
            name
            delta
            quantityAfterChange
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      reason: "correction",
      name: "available",
      ignoreCompareQuantity: true,
      quantities: [
        {
          inventoryItemId,
          locationId,
          quantity: parseInt(available, 10),
        },
      ],
    },
  };

  try {
    const res = await axiosInstance.post("", { query: mutation, variables });
    
    // Verificar si hay errores de usuario
    if (res.data.data?.inventorySetQuantities?.userErrors?.length > 0) {
      return { 
        success: false, 
        userErrors: res.data.data.inventorySetQuantities.userErrors 
      };
    }
    
    return { 
      success: true, 
      data: res.data.data.inventorySetQuantities 
    };
  } catch (err) {
    console.error("Error setting inventory (GraphQL):", err?.response?.data || err.message);
    return { 
      success: false, 
      error: err?.response?.data || err.message 
    };
  }
};

const processRow = async (row) => {
  const sku = String(row.sku || "").trim();
  const locationName = String(row.location_name || "").trim();
  const available = parseInt(row.available, 10);

  if (!sku || !locationName || isNaN(available)) {
    return { 
      sku, 
      locationName, 
      result: "error", 
      message: "Missing or invalid data (sku, location_name, or available)" 
    };
  }

  try {
    // 1. Buscar producto por SKU
    console.log(`  → Searching product with SKU: ${sku}`);
    const found = await findProductBySKU(sku);
    if (!found || !found.variant) {
      return { 
        sku, 
        locationName, 
        result: "error", 
        message: "Product/variant not found by SKU" 
      };
    }

    const inventoryItemId = found.variant.inventory_item_id
      ? `gid://shopify/InventoryItem/${found.variant.inventory_item_id}`
      : null;

    if (!inventoryItemId) {
      return { 
        sku, 
        locationName, 
        result: "error", 
        message: "Variant has no inventory_item_id" 
      };
    }

    console.log(`  → Found inventory item: ${inventoryItemId}`);

    // 2. Buscar ubicación
    console.log(`  → Searching location: ${locationName}`);
    const location = await getLocationByName(locationName);
    if (!location) {
      return { 
        sku, 
        locationName, 
        result: "error", 
        message: "Location not found" 
      };
    }

    const locationId = location.id;
    console.log(`  → Found location: ${locationId} (Active: ${location.isActive})`);

    // Si la ubicación está inactiva, informar pero continuar
    if (!location.isActive) {
      console.log(`  ⚠️  Location "${locationName}" is INACTIVE, but will attempt to set inventory anyway`);
    }

    // 3. Verificar si existe el nivel de inventario
    let inventoryLevel = await getInventoryLevel(inventoryItemId, locationId);

    if (!inventoryLevel) {
      // No existe, necesitamos conectarlo primero (funciona incluso con ubicaciones inactivas)
      console.log(`  → Inventory not connected to this location. Connecting...`);
      
      const connectionRes = await connectInventoryToLocation(inventoryItemId, locationId);
      
      if (!connectionRes.success) {
        return {
          sku,
          locationName,
          result: "error",
          message: `Failed to connect inventory to location: ${JSON.stringify(connectionRes.error)}`,
        };
      }
      
      if (connectionRes.alreadyExists) {
        console.log(`  → Inventory already connected`);
      } else {
        console.log(`  → Inventory level connected successfully`);
      }
      
      await sleep(500);
      
      // Verificar nuevamente
      inventoryLevel = await getInventoryLevel(inventoryItemId, locationId);
      
      if (!inventoryLevel) {
        // Si aún no existe después de conectar, puede ser que la ubicación esté inactiva
        // Intentaremos actualizar de todas formas
        console.log(`  ⚠️  Inventory level still not found, but will attempt update anyway`);
      }
    }

    const currentStock = inventoryLevel?.available || 0;
    console.log(`  → Current stock: ${currentStock}`);
    console.log(`  → Setting stock to: ${available} (using inventorySetQuantities GraphQL)`);

    // 4. Actualizar cantidad usando inventorySetQuantities (GraphQL)
    const updateRes = await setInventoryGraphQL(inventoryItemId, locationId, available);

    if (!updateRes.success) {
      const errorMsg = updateRes.userErrors 
        ? updateRes.userErrors.map(e => e.message).join(", ")
        : JSON.stringify(updateRes.error);
      
      return {
        sku,
        locationName,
        result: "error",
        message: `Failed to set inventory: ${errorMsg}`,
      };
    }

    console.log(`  → Stock updated successfully via GraphQL!`);

    return {
      sku,
      locationName,
      result: "success",
      message: `Stock updated from ${currentStock} to ${available} (GraphQL inventorySetQuantities)${!location.isActive ? ' [Location was INACTIVE]' : ''}`,
    };

  } catch (err) {
    return { 
      sku, 
      locationName, 
      result: "error", 
      message: `Exception: ${err.message}` 
    };
  } finally {
    await sleep(400);
  }
};

const writeReport = async (rows, outPath) => {
  const csvWriter = createObjectCsvWriter({
    path: outPath,
    header: [
      { id: "sku", title: "sku" },
      { id: "locationName", title: "location_name" },
      { id: "result", title: "result" },
      { id: "message", title: "message" },
    ],
  });
  await csvWriter.writeRecords(rows);
};

// Función para generar timestamp en horario de Chile
function getChileTimestamp() {
  const now = new Date();
  const options = {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  
  const formatter = new Intl.DateTimeFormat('es-CL', options);
  const parts = formatter.formatToParts(now);
  
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  const second = parts.find(p => p.type === 'second').value;
  
  return `${year}-${month}-${day}-${hour}${minute}${second}`;
}

const main = async () => {
  try {
    const csvPath = path.resolve(process.cwd(), "examples", "inventory.csv");
    if (!fs.existsSync(csvPath)) {
      console.error("CSV file not found:", csvPath);
      process.exit(1);
    }

    const rows = await readCsv(csvPath);
    console.log(`\n📦 Processing ${rows.length} inventory records using GraphQL inventorySetQuantities...\n`);
    
    const report = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      console.log(`\n[${i + 1}/${rows.length}] Processing SKU: ${row.sku} @ ${row.location_name}`);
      
      try {
        const res = await processRow(row);
        console.log(`  ✓ Result: ${res.result} - ${res.message}`);
        report.push(res);
      } catch (error) {
        console.error(`  ✗ Error processing row:`, error.message);
        report.push({
          sku: row.sku || "unknown",
          locationName: row.location_name || "unknown",
          result: "error",
          message: `Unexpected error: ${error.message}`
        });
      }
    }

    // Generar timestamp en horario de Chile
    const timestamp = getChileTimestamp();
    const outPath = path.resolve(process.cwd(), "reports", `inventory-report-${timestamp}.csv`);
    
    // Crear carpeta reports si no existe
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    
    // Escribir reporte
    await writeReport(report, outPath);
    
    // Resumen
    const success = report.filter(r => r.result === "success").length;
    const errors = report.filter(r => r.result === "error").length;
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY");
    console.log("=".repeat(60));
    console.log(`✓ Successful: ${success}`);
    console.log(`✗ Errors: ${errors}`);
    console.log(`📄 Report: ${outPath}`);
    console.log(`🔧 Method: GraphQL inventorySetQuantities mutation`);
    console.log("=".repeat(60) + "\n");
    
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
};

main();