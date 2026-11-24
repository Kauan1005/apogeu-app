import { connection } from "next/server";
import { LoginScreen } from "./login-form";

// renderização dinâmica: a página recebe o nonce da CSP a cada visita
export default async function Login() {
  await connection();
  return <LoginScreen />;
}
