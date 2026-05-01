import { Suspense } from "react";
import NewSessionClient from "./NewSessionClient";

export default function NewSessionPage() {
  return (
    <Suspense>
      <NewSessionClient />
    </Suspense>
  );
}
