import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBl5RHbG5ijwq8_ApYMnIysuB6ZfGAZHaQ",
  authDomain: "world-domination-a9129.firebaseapp.com",
  projectId: "world-domination-a9129",
  storageBucket: "world-domination-a9129.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;