// import React, { useEffect, useMemo, useRef, useState } from "react";
// import { Send } from "lucide-react";

// type Msg = { id: string; from: "me" | "them" | "system"; text: string; ts: number };
// type Thread = {
//   id: string;
//   title: string;
//   avatar: string;
//   unread?: number;
//   lastMsg: string;
//   lastTs: number;
//   messages: Msg[];
// };

// const formatTime = (ts: number) => {
//   const d = new Date(ts);
//   const hh = d.getHours() % 12 || 12;
//   const mm = String(d.getMinutes()).padStart(2, "0");
//   const ap = d.getHours() >= 12 ? "PM" : "AM";
//   return `${hh}:${mm} ${ap}`;
// };

// function Avatar({ label }: { label: string }) {
//   return (
//     <div className="h-9 w-9 bg-violet-700 text-white grid place-items-center font-semibold">
//       {label}
//     </div>
//   );
// }

// export default function ChatDashboard() {
//   const [threads, setThreads] = useState<Thread[]>([]);
//   const [activeId, setActiveId] = useState<string>("");
//   const [text, setText] = useState("");
//   const scrollerRef = useRef<HTMLDivElement | null>(null);

//   const active = useMemo(() => threads.find((t) => t.id === activeId)!, [threads, activeId]);

//   // ---- WebSocket connection for live updates ----
//   useEffect(() => {
//     const ws = new WebSocket("ws://localhost:8000/ws/console?tenant_id=demo_tenant&agent_id=agent_demo");
//     ws.onopen = () => console.log("✅ Agent console WS connected");

//     ws.onmessage = (evt) => {
//       try {
//         const msg = JSON.parse(evt.data);

//         // ✅ Normal message flow
//         if (msg.type === "message") {
//           const ts = Date.now();
//           setThreads((prev) =>
//             prev.map((t) =>
//               t.id === msg.conversation_id
//                 ? {
//                     ...t,
//                     messages: [
//                       ...t.messages,
//                       {
//                         id: Math.random().toString(36).slice(2),
//                         from:
//                           msg.sender === "user"
//                             ? "them"
//                             : msg.sender === "agent"
//                             ? "me"
//                             : "system",
//                         text: msg.text,
//                         ts,
//                       },
//                     ],
//                     lastMsg: msg.text,
//                     lastTs: ts,
//                   }
//                 : t
//             )
//           );
//         }

//         // ✅ Initial snapshot (existing conversations)
//         if (msg.type === "snapshot") {
//           setThreads((prev) => {
//             const map = new Map(prev.map((t) => [t.id, t]));
//             msg.conversations?.forEach((c: any) => {
//               if (!map.has(c.id)) {
//                 map.set(c.id, {
//                   id: c.id,
//                   title: c.id,
//                   avatar: c.id[0]?.toUpperCase() || "?",
//                   lastMsg: "",
//                   lastTs: Date.now(),
//                   messages: [],
//                   unread: 0,
//                 });
//               }
//             });
//             const arr = Array.from(map.values()).sort((a, b) => b.lastTs - a.lastTs);
//             if (!activeId && arr.length > 0) {
//               setActiveId(arr[0].id);
//             }
//             return arr;
//           });
//         }

//         // ✅ NEW: handle escalation events (AI → Agent handoff)
//         if (msg.type === "escalation") {
//           console.log("🚨 Escalation received:", msg);
//           setThreads((prev) => {
//             const exists = prev.some((t) => t.id === msg.conversation_id);
//             if (exists) return prev;
//             const newThread: Thread = {
//               id: msg.conversation_id,
//               title: msg.conversation_id,
//               avatar: msg.conversation_id[0]?.toUpperCase() || "?",
//               lastMsg: msg.reason || "Escalation triggered",
//               lastTs: Date.now(),
//               messages: [
//                 {
//                   id: Math.random().toString(36).slice(2),
//                   from: "system",
//                   text: "This chat is now handled by our support team.",
//                   ts: Date.now(),
//                 },
//               ],
//               unread: 1,
//             };
//             return [newThread, ...prev];
//           });
//         }
//       } catch (e) {
//         console.error("WS parse error", e);
//       }
//     };

//     ws.onclose = () => console.log("❌ Agent console WS disconnected");
//     return () => ws.close();
//   }, [activeId]);

//   // ---- Fetch messages when active thread changes ----
//   useEffect(() => {
//     if (!activeId) return;
//     (async () => {
//       try {
//         const res = await fetch(
//           `http://localhost:8000/messages?conversation_id=${activeId}&limit=100`
//         );
//         if (res.ok) {
//           const data = await res.json();
//           setThreads((prev) =>
//             prev.map((t) =>
//               t.id === activeId
//                 ? {
//                     ...t,
//                     messages: data.map((m: any) => ({
//                       id: m.id,
//                       from:
//                         m.sender === "user"
//                           ? "them"
//                           : m.sender === "agent"
//                           ? "me"
//                           : "system",
//                       text: m.text,
//                       ts: new Date(m.created_at || Date.now()).getTime(),
//                     })),
//                   }
//                 : t
//             )
//           );
//         }
//       } catch (e) {
//         console.error("Failed to load messages", e);
//       }
//     })();
//   }, [activeId]);

//   // ---- Send agent reply ----
//   const send = () => {
//     const v = text.trim();
//     if (!v || !activeId) {
//       console.warn("❌ Cannot send — empty text or no active conversation", { v, activeId });
//       return;
//     }

//     console.log("➡️ Sending agent message:", { conversation_id: activeId, text: v });

//     setText("");
//     requestAnimationFrame(() => {
//       scrollerRef.current?.scrollTo({
//         top: scrollerRef.current!.scrollHeight,
//         behavior: "smooth",
//       });
//     });

//     fetch("http://localhost:8000/agent/messages", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ conversation_id: activeId, text: v }),
//     })
//       .then((res) => res.json())
//       .then((data) => console.log("✅ Agent API response:", data))
//       .catch((err) => console.error("❌ Fetch error:", err));
//   };

//   const onKeyDownComposer: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
//     if (e.key === "Enter" && !e.shiftKey) {
//       e.preventDefault();
//       send();
//     }
//   };

//   return (
//     <div className="h-screen w-full bg-slate-100">
//       <div className="h-full bg-white shadow ring-1 ring-slate-200 grid grid-cols-[320px,1fr]">
//         {/* Left: Thread list */}
//         <section className="border-r border-slate-200 flex flex-col">
//           <div className="h-[52px] border-b border-slate-200 px-4 flex items-center">
//             <div className="text-xs font-semibold tracking-wide text-slate-600">
//               MESSAGES
//             </div>
//           </div>
//           <div className="flex-1 overflow-y-auto p-2">
//             {threads.map((t) => (
//               <button
//                 key={t.id}
//                 onClick={() => setActiveId(t.id)}
//                 className={`w-full flex items-center gap-3 px-3 py-2 text-left border ${
//                   t.id === activeId
//                     ? "bg-slate-50 border-slate-300"
//                     : "bg-white border-slate-200"
//                 }`}
//               >
//                 <Avatar label={t.avatar} />
//                 <div className="flex-1 truncate">{t.title}</div>
//               </button>
//             ))}
//           </div>
//         </section>

//         {/* Right: Chat panel */}
//         <main className="flex flex-col h-full">
//           {/* Messages area */}
//           <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
//             {active ? (
//               active.messages.length > 0 ? (
//                 active.messages.map((m) => (
//                   <div
//                     key={m.id}
//                     className={`w-full flex ${
//                       m.from === "me" ? "justify-end" : "justify-start"
//                     }`}
//                   >
//                     <div
//                       className={`max-w-[70%] px-4 py-3 text-[15px] leading-snug shadow-sm border ${
//                         m.from === "me"
//                           ? "bg-violet-600 text-white border-violet-600"
//                           : m.from === "system"
//                           ? "bg-amber-50 text-amber-900 border-amber-200"
//                           : "bg-white text-slate-900 border-slate-200"
//                       }`}
//                     >
//                       <div>{m.text}</div>
//                       <div className="text-[11px] mt-1 text-slate-500">
//                         {formatTime(m.ts)}
//                       </div>
//                     </div>
//                   </div>
//                 ))
//               ) : (
//                 <div className="text-sm text-slate-400">No messages yet…</div>
//               )
//             ) : (
//               <div className="flex-1 flex items-center justify-center text-slate-400">
//                 Select a conversation to start chatting
//               </div>
//             )}
//           </div>

//           {/* Composer always visible */}
//           <div className="border-t border-slate-200 p-3">
//             <div className="flex items-end gap-2">
//               <div className="flex-1">
//                 <textarea
//                   rows={1}
//                   value={text}
//                   onChange={(e) => setText(e.target.value)}
//                   onKeyDown={onKeyDownComposer}
//                   placeholder="Type your message"
//                   className="w-full resize-none border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
//                 />
//               </div>
//               <button
//                 onClick={send}
//                 className="h-10 w-10 grid place-items-center bg-violet-700 text-white hover:bg-violet-800"
//                 title="Send"
//               >
//                 <Send className="h-5 w-5" />
//               </button>
//             </div>
//           </div>
//         </main>
//       </div>
//     </div>
//   );
// }
