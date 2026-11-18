import React from "react";
import { SidebarThreadsControl } from "../../src/components/SidebarThreadsControl";
import { createRoot } from "react-dom/client";
import { ReplyComposer } from "../../src/components/ReplyComposer";
import "../../src/styles.css";
const id=new URLSearchParams(location.search).get("draft")!;
createRoot(document.getElementById("root")!).render(<main className="min-h-screen bg-base p-8"><SidebarThreadsControl/><ReplyComposer id={id}/></main>);
