// ==========================================================
// js/firebase-config.js
// Cole aqui as credenciais do SEU projeto Firebase.
// Console Firebase > Configurações do projeto > Seus apps > SDK setup and configuration
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBrpLzfEXijVejqyUUr2FhD_HWkJWPyYjI",
  authDomain: "painel-pessoal-trabalho.firebaseapp.com",
  projectId: "painel-pessoal-trabalho",
  storageBucket: "painel-pessoal-trabalho.firebasestorage.app",
  messagingSenderId: "1001695709330",
  appId: "1:1001695709330:web:dbd89e5da90be79e0dfe4b"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Opcional: força a tela de seleção de conta sempre que o usuário clicar em "Entrar"
googleProvider.setCustomParameters({ prompt: "select_account" });