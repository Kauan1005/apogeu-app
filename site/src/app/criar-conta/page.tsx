import { connection } from "next/server";
import { SignUpForm } from "./signup-form";

// renderização dinâmica: a página recebe o nonce da CSP a cada visita
export default async function CriarConta() {
  await connection();
  return <SignUpForm />;
}
