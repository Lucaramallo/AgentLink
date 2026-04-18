import { fetchAgents } from "../lib/api";
import DirectoryClient from "./DirectoryClient";

export default async function DirectoryPage() {
  const agents = await fetchAgents();
  return <DirectoryClient agents={agents} />;
}
