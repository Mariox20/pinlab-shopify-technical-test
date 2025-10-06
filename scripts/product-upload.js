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

const BASE_URL = `https://${STORE}/admin/api/${API_VERSION}`;

const axiosInstance = axios.create({
  baseURL: BASE_URL,
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

const findProductByHandle = async (handle) => {
  const url = `/products.json?handle=${encodeURIComponent(handle)}`;
  const res = await axiosInstance.get(url);
  return res.data.products && res.data.products.length ? res.data.products[0] : null;
};

const createProduct = async (payload) => {
  const res = await axiosInstance.post("/products.json", { product: payload });
  return res.data.product;
};

const updateProduct = async (productId, payload) => {
  const res = await axiosInstance.put(`/products/${productId}.json`, { product: payload });
  return res.data.product;
};

const updateVariant = async (variantId, payload) => {
  const res = await axiosInstance.put(`/variants/${variantId}.json`, { variant: payload });
  return res.data.variant;
};

const createVariant = async (productId, payload) => {
  const res = await axiosInstance.post(`/products/${productId}/variants.json`, { variant: payload });
  return res.data.variant;
};

const addImageToProduct = async (productId, imagePayload) => {
  const res = await axiosInstance.post(`/products/${productId}/images.json`, { image: imagePayload });
  return res.data.image;
};

const ensureImages = async (product, imageUrls) => {
  const existingSrc = (product.images || []).map((i) => i.src);
  for (const src of imageUrls) {
    if (!existingSrc.includes(src)) {
      await addImageToProduct(product.id, { src });
      await sleep(300);
    }
  }
};

const normalize = (str) => (str ? String(str).trim() : "");

const processRow = async (row) => {
  const handle = normalize(row.handle).toLowerCase();
  const title = normalize(row.title) || handle;
  const body_html = normalize(row.body_html) || "";
  const price = normalize(row.price) || "0";
  const sku = normalize(row.sku);
  const barcode = normalize(row.barcode) || "";
  const option1_name = normalize(row.option1_name) || "Title";
  const option1_value = normalize(row.option1_value) || "Default";
  const imagesRaw = normalize(row.images) || "";
  const imageUrls = imagesRaw ? imagesRaw.split(";").map((s) => s.trim()).filter(Boolean) : [];

  try {
    const existingProduct = await findProductByHandle(handle);
    if (existingProduct) {
      const variants = existingProduct.variants || [];
      const matchedVariant = variants.find((v) => v.sku && v.sku === sku);
      if (matchedVariant) {
        const variantPayload = { id: matchedVariant.id, price, sku, barcode };
        await updateVariant(matchedVariant.id, variantPayload);
        if (imageUrls.length) await ensureImages(existingProduct, imageUrls);
        return { handle, sku, result: "updated_variant", message: `variant ${matchedVariant.id} updated` };
      } else {
        const newVariantPayload = { option1: option1_value, price, sku, barcode };
        const newVariant = await createVariant(existingProduct.id, newVariantPayload);
        if (imageUrls.length) await ensureImages(existingProduct, imageUrls);
        return { handle, sku, result: "created_variant", message: `variant ${newVariant.id} created` };
      }
    } else {
      const productPayload = {
        title,
        body_html,
        handle,
        variants: [{ option1: option1_value, price, sku, barcode }],
        images: imageUrls.map((src) => ({ src })),
      };
      const newProduct = await createProduct(productPayload);
      return { handle, sku, result: "created_product", message: `product ${newProduct.id} created` };
    }
  } catch (err) {
    const errMsg = err?.response?.data || err.message || String(err);
    return { handle, sku, result: "error", message: JSON.stringify(errMsg) };
  } finally {
    await sleep(500);
  }
};

const writeReport = async (rows, outPath) => {
  const csvWriter = createObjectCsvWriter({
    path: outPath,
    header: [
      { id: "handle", title: "handle" },
      { id: "sku", title: "sku" },
      { id: "result", title: "result" },
      { id: "message", title: "message" },
    ],
  });
  await csvWriter.writeRecords(rows);
};

const main = async () => {
  try {
    const csvPath = path.resolve(process.cwd(), "examples", "products.csv");
    if (!fs.existsSync(csvPath)) {
      console.error("CSV file not found:", csvPath);
      process.exit(1);
    }
    const rows = await readCsv(csvPath);
    const report = [];
    for (const r of rows) {
      const res = await processRow(r);
      console.log(res);
      report.push(res);
    }
    const outPath = path.resolve(process.cwd(), "reports", `product-report-${Date.now()}.csv`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await writeReport(report, outPath);
    console.log("Report generated:", outPath);
  } catch (err) {
    console.error("Fatal error", err);
    process.exit(1);
  }
};

main();
