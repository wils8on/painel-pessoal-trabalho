// =========================================================
// js/cloudinary-config.js
// Cole aqui os dados da SUA conta Cloudinary (são públicos por natureza —
// não é preciso, e não é seguro, colocar a "API Secret" no front-end).
//
// 1. Acesse https://console.cloudinary.com > Dashboard e copie o "Cloud name".
// 2. Vá em Settings (engrenagem) > Upload > Upload presets > "Add upload preset".
//    Em "Signing Mode" escolha UNSIGNED, salve e copie o nome do preset.
//    Dica de segurança: como o preset unsigned fica público no código-fonte,
//    configure nele uma pasta fixa (ex: "nova-app") e um limite de tamanho/
//    formato em "Upload Manipulations", para evitar abuso da sua conta.
// =========================================================
export const CLOUDINARY_CLOUD_NAME = "ffril2cr";
export const CLOUDINARY_UPLOAD_PRESET = "dossie";

/**
 * Envia qualquer arquivo (imagem, PDF, docx, etc.) para o Cloudinary via
 * upload não assinado, usando o endpoint "auto" que detecta o tipo sozinho.
 * @param {File} file
 * @returns {Promise<{url:string, name:string, format:string, resourceType:string, bytes:number}>}
 */
export async function uploadFileToCloudinary(file) {
  if (!file) throw new Error("Nenhum arquivo informado.");
  if (CLOUDINARY_CLOUD_NAME.startsWith("COLE_")) {
    throw new Error("Configure js/cloudinary-config.js com seu Cloud name e Upload preset antes de enviar arquivos.");
  }
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
 
  const res = await fetch(endpoint, { method: "POST", body: formData });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || "Falha no upload do arquivo para o Cloudinary.");
  }
  const data = await res.json();
  return {
    url: data.secure_url,
    name: file.name,
    format: data.format || file.name.split(".").pop() || "",
    resourceType: data.resource_type || "raw", // "image", "video" ou "raw"
    bytes: data.bytes || file.size,
  };
}
 
// Mantido por compatibilidade: upload apenas de imagem (usa a mesma rota "auto").
export async function uploadImageToCloudinary(file) {
  const result = await uploadFileToCloudinary(file);
  return result.url;
}
 