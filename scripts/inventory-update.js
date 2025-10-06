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

const axiosInstance = axios.create({
  baseURL: GRAPHQL_URL,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json",
  },
  timeout: 20000,
});

const readCsv = (filePath) =>
  new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => rows.push(data))
      .on("end", () => resolve(rows))
      .on("error", (err) => reject(err));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Helper functions ---

const findProductBySKU = async (sku) => {
  const url = `https://${STORE}/admin/api/${API_VERSION}/products.json?fields=id,variants&variant_sku=${encodeURIComponent(
    sku
  )}`;
  const res = await axios.get(url, {
    headers: { "X-Shopify-Access-Token": TOKEN },
  });
  if (res.data.products && res.data.products.length) {
    const product = res.data.products[0];
    const variant = product.variants.find((v) => v.sku === sku);
    return { product, variant };
  }
  return null;
};

const getLocationIdByName = async (locationName) => {
  const query = `
    query {
      locations(first: 50) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;
  const res = await axiosInstance.post("", { query });
  const locations = res.data.data.locations.edges.map((e) => e.node);
  const location = locations.find((loc) => loc.name === locationName);
  return location ? location.id : null;
};

const setInventory = async (inventoryItemId, locationId, available) => {
  const mutation = `
    mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          createdAt
          reason
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
      name: "absolute_adjustment",
      changes: [
        {
          inventoryItemId,
          locationId,
          quantity: parseInt(available, 10),
        },
      ],
    },
  };

  const res = await axiosInstance.post("", { query: mutation, variables });
  return res.data;
};

const processRow = async (row) => {
  const sku = String(row.sku).trim();
  const locationName = String(row.location_name).trim();
  const available = parseInt(row.available, 10);

  if (!sku || !locationName) {
    return { sku, locationName, result: "error", message: "Missing data" };
  }

  try {
    const found = await findProductBySKU(sku);
    if (!found || !found.variant) {
      return { sku, locationName, result: "error", message: "Product not found by SKU" };
    }

    const inventoryItemId = found.variant.inventory_item_id
      ? `gid://shopify/InventoryItem/${found.variant.inventory_item_id}`
      : null;

    const locationId = await getLocationIdByName(locationName);
    if (!locationId) {
      return { sku, locationName, result: "error", message: "Location not found" };
    }

    const res = await setInventory(inventoryItemId, locationId, available);

    if (res.data?.inventorySetQuantities?.userErrors?.length) {
      return {
        sku,
        locationName,
        result: "error",
        message: JSON.stringify(res.data.inventorySetQuantities.userErrors),
      };
    }

    return {
      sku,
      locationName,
      result: "success",
      message: `Stock set to ${available}`,
    };
  } catch (err) {
    return { sku, locationName, result: "error", message: err.message };
  } finally {
    await sleep(300);
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
  
  // Formato: YYYY-MM-DD-HHMMSS
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
    const report = [];

    for (const row of rows) {
      try {
        const res = await processRow(row);
        if (res.message && res.message.toLowerCase().includes("location not found")) {
          res.message = `Location "${row.location_name}" not found or inactive`;
        }

        console.log(res);
        report.push(res);

      } catch (error) {
        console.error("Error processing row:", row, error);

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

    // Crear ruta del reporte
    const outPath = path.resolve(process.cwd(), "reports", `inventory-report-${timestamp}.csv`);
    
    // Crear carpeta reports si no existe
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    
    // Escribir reporte
    await writeReport(report, outPath);
    
    console.log("Report generated:", outPath);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
};

main();
