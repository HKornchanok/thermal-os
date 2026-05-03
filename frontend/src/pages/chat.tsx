import Head from "next/head";
import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useChat } from "@/lib/hooks/use-chat";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant";

interface Message {
  role: ChatRole;
  content: string;
}

const EXAMPLE_PROMPTS: string[] = [
  "Why was energy so high yesterday?",
  "Which machine consumes the most right now?",
  "What did the AI change overnight?",
  "Summarize the alerts I should look at first.",
];

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const chat = useChat();

  // Auto-scroll the transcript to the bottom as new messages land.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, chat.isPending]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || chat.isPending) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");

    try {
      const resp = await chat.mutateAsync({ message: trimmed });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: resp.reply },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${msg}`,
        },
      ]);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send(input);
  };

  // Cmd/Ctrl+Enter submits — same shortcut every chat UI uses.
  // Plain Enter inserts a newline so longer questions don't get cut off.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send(input);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <>
      <Head>
        <title>AI Assistant · ThermalOS</title>
      </Head>

      <div className="flex h-[calc(100vh-8rem)] flex-col">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="mt-0 text-2xl font-semibold">AI Assistant</h1>
          <p className="text-xs text-muted-foreground">
            Grounded in live building telemetry
          </p>
        </div>

        {/* Transcript */}
        <div
          ref={scrollRef}
          data-testid="chat-transcript"
          className="mt-4 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4"
        >
          {isEmpty ? (
            <EmptyChat onPick={(p) => void send(p)} disabled={chat.isPending} />
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} />
              ))}
              {chat.isPending && (
                <MessageBubble
                  role="assistant"
                  content="Thinking…"
                  testId="chat-pending"
                />
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={onSubmit}
          className="mt-3 flex items-end gap-2"
          data-testid="chat-form"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about machines, energy, or recent decisions… (⌘/Ctrl+Enter to send)"
            rows={2}
            disabled={chat.isPending}
            data-testid="chat-input"
            className={cn(
              "flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          />
          <Button
            type="submit"
            disabled={!input.trim() || chat.isPending}
            data-testid="chat-send"
          >
            <Send className="h-4 w-4" />
            Send
          </Button>
        </form>
      </div>
    </>
  );
}

function EmptyChat({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <Sparkles className="h-8 w-8 text-primary" aria-hidden />
      <div>
        <p className="text-sm font-medium text-foreground">
          Ask anything about the building
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Replies are grounded in the latest sensor snapshot, energy totals, and
          the last 20 AI decisions.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            disabled={disabled}
            className={cn(
              "rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground",
              "transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  testId,
}: {
  role: ChatRole;
  content: string;
  testId?: string;
}) {
  const isUser = role === "user";
  return (
    <div
      data-testid={testId ?? `chat-msg-${role}`}
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm",
          isUser
            ? "border-primary/40 bg-primary/10 text-foreground"
            : "bg-muted/40 border-border text-foreground"
        )}
      >
        {content}
      </div>
    </div>
  );
}
