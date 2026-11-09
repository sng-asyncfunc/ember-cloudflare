import { ASSISTANT_ID, type Room, type User } from "@ember/protocol";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Whether someone is @ember, the AI assistant Ember AI answers as, whose name the agent badge follows. */
export const isAssistant = (user: User) => user.id === ASSISTANT_ID;

/** Whether a room is someone's DM with @ember alone, which is named after it, so its name takes the badge too. */
export const isWithAssistant = (room: Room) => room.kind === "direct" && room.members.length === 2 && room.members.some(isAssistant);

/**
 * The badge after @ember's name, so nobody takes it for a person: "Agent" in capitals at 10px on a pill
 * of the ink at 8%, which stays in sight on a hovered or picked row too. It's written as a word after a
 * space, so that screen readers say the name and it as two words, though a row of flex items doesn't
 * show the space. The mentions prompt draws it from its own markup (`.autocompletable__badge` in
 * rich-text-editor.css).
 */
export function AgentBadge({ className }: { className?: string }) {
  return (
    <>
      {" "}
      <Badge
        variant="secondary"
        className={cn("bg-foreground/8 px-1.5 py-0 text-[10px] leading-4 font-semibold tracking-wider text-message-muted uppercase", className)}
      >
        Agent
      </Badge>
    </>
  );
}
