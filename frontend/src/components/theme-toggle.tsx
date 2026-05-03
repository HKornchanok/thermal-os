import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Cycles through light → dark → system → light.
 *
 * Three states (rather than a binary toggle) so users can opt back into
 * "follow OS" without clearing localStorage. The icon shows the CURRENT
 * setting, not where the next click leads.
 *
 * The component renders a placeholder on the server and the first client
 * render — the actual theme isn't known until next-themes hydrates from
 * storage / matchMedia. This avoids the React hydration-mismatch warning.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        className={className}
        disabled
      />
    );
  }

  const next: Record<string, string> = {
    light: "dark",
    dark: "system",
    system: "light",
  };

  const icons: Record<string, React.ReactNode> = {
    light: <Sun className="size-4" aria-hidden />,
    dark: <Moon className="size-4" aria-hidden />,
    system: <Laptop className="size-4" aria-hidden />,
  };

  const current = theme ?? "system";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${current}. Click to switch to ${next[current]}.`}
      title={`Theme: ${current}`}
      onClick={() => setTheme(next[current])}
      className={className}
    >
      {icons[current]}
    </Button>
  );
}
