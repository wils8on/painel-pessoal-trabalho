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
 * Envia um arquivo de imagem para o Cloudinary via upload não assinado
 * e devolve a URL segura (https) da imagem hospedada.
 * @param {File} file
 * @returns {Promise<string>} secure_url
 */
export async function uploadImageToCloudinary(file) {
  if (!file) throw new Error("Nenhum arquivo informado.");
  if (CLOUDINARY_CLOUD_NAME.startsWith("COLE_")) {
    throw new Error("Configure js/cloudinary-config.js com seu Cloud name e Upload preset antes de enviar imagens.");
  }
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(endpoint, { method: "POST", body: formData });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || "Falha no upload da imagem para o Cloudinary.");
  }
  const data = await res.json();
  return data.secure_url;
}