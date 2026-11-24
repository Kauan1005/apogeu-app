import { connection } from "next/server";
import { MfaScreen } from "./mfa-form";

export default async function Mfa() {
  await connection();
  return <MfaScreen />;
}
