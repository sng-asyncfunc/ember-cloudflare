import { useContext, useEffect, useEffectEvent, useState } from "react";
import { ASSISTANT_ID, AVATAR_TOO_LARGE, MAX_AVATAR_SIZE, type WorkspaceSettings } from "@ember/protocol";
import {
  cannotSearchWith,
  MAX_ASSISTANT_MODELS,
  MODELS_FULL,
  modelName,
  PAGES_READ_PER_ANSWER,
  WEB_SEARCHES_PER_ANSWER,
  type AssistantChanges,
  type AssistantModel,
  type AssistantSettings as Assistant,
  type WebTool,
} from "@ember/protocol/assistant";
import { useFlash } from "@/components/flash";
import { Switch } from "@/components/ui/switch";
import { PeopleContext } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import {
  ApiError,
  changeAssistantAvatar,
  changeAssistantSettings,
  changeWebSearch,
  fetchWorkspaceSettings,
  forgetAssistant,
  isSignedOut,
  removeAssistantAvatar,
  removeAssistantModel,
} from "@/lib/api";
import { avatarVariantOf } from "@/lib/previews";
import { cn } from "@/lib/utils";
import { AddAssistantModel } from "./add-assistant-model";
import { searchTurnedOff } from "./assistant-setup";
import { BUTTON } from "./email-settings";
import { LevelDials } from "./level-dials";
import { PictureField } from "./picture-picker";
import { CHANGES_SAVED } from "./settings-page";
import { avatarVersionOf } from "./user-avatar";

// The Ember AI card on the AI assistant tab, for administrators: whether @ember, an AI assistant in every
// room open to everyone, runs on a model through Cloudflare AI Gateway, and which. Its switch says
// whether it does, as Turnstile's does. Turning it on opens Set up Ember AI (`AssistantSetup`), as
// switches open setup that's missing, as the project's owner asked (2026-10-26), and turning it off takes
// @ember out of every room and forgets the API token and the models people could pick. Change opens the
// setup with the account and model as they are. While it's on, the card says what @ember sends the model,
// which its provider reads, shows @ember's avatar, which a picture picked replaces, as the project's owner
// asked (2026-11-05), and Use Ember's flame takes away again, lists the models people can pick on their
// profile, the one that answers everyone else chosen, with Add a model and each other's Remove, has Search
// the web's switch, which turns on once the model that answers everyone has searched the web for a test
// question, saying what it found, or opens the setup for a model that can't search, and the dials of the
// most @ember may think and write for anyone's question. Each change saves at once. While one saves,
// Ember AI can't be turned off or changed, so that the save's answer can't show it as it was.

/** What @ember sends the model as it answers, which the card says while Ember AI is on. */
export const WHAT_EMBER_SENDS = "Mention @ember, or write to it directly, and it answers, sending the thread, or the room's latest messages, through Cloudflare to the model.";

/** What the card says of its models. */
export const MODELS_EXPLAINED = "People can pick any of these on their profile for @ember to answer them with. The one chosen here answers everyone else.";

/** What the card says of its dials. */
export const LIMITS_EXPLAINED =
  "The most @ember may think and write for anyone's question. Each person picks their own levels on their profile, up to these. AI Gateway's spend limits can cap what each person's questions cost, as every request says who asked.";

/** What the card says of Search the web while it's off, for a model that can search. */
export const WEB_SEARCH_OFF = `@ember answers from what its model learned in training. Turn this on to let it search the web when a question needs what's current, at most ${WEB_SEARCHES_PER_ANSWER} times an answer, and list the pages it used under its answer.`;

/** What the card says of Search the web while it's on, letting @ember do `webTools` on the web, while people can pick from `models`. */
export function webSearchOn(webTools: WebTool[], models: readonly AssistantModel[]): string {
  const reads = webTools.includes("read") ? `, and reads the pages people link to or its searches find, at most ${PAGES_READ_PER_ANSWER}` : "";
  const picked = models.length > 1 ? " A model someone picks searches too, if it's Anthropic's or OpenAI's." : "";
  return `@ember searches the web when a question needs it, at most ${WEB_SEARCHES_PER_ANSWER} times an answer${reads}, and lists the pages it used under its answer.${picked} AI Gateway's credits pay for each search.`;
}

/** What the card says while the model called `name` searches the web for Search the web's test question. */
export const searchingWith = (name: string) => `Asking ${name} something it has to search the web for…`;

/** What the card says of @ember's avatar while it's Ember's flame. */
export const AVATAR_EXPLAINED = "Everyone sees it beside @ember's answers. Choose a picture of your own in place of Ember's flame.";

/** What it says once an administrator has uploaded one. */
export const UPLOADED_AVATAR_EXPLAINED = "Everyone sees it beside @ember's answers. Choose another picture, or go back to Ember's flame.";

/** What turning Ember AI off asks first. */
export const CONFIRM_STOP_ASSISTANT =
  "Are you sure you want to turn off Ember AI? @ember will leave every room, and Ember will forget the API token and the models people can pick.";

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

interface Props {
  assistant: WorkspaceSettings["assistant"];
  /** Opens Set up Ember AI. */
  onSetUp: () => void;
  /** Shows that Ember AI is off, once turning it off has, or once it's found to be. */
  onStopped: () => void;
  /** Shows Ember AI as a change to its models, dials or Search the web leaves it, or as it was again when the change fails. */
  onChanged: (assistant: Assistant) => void;
  /** Says why turning it off failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * What came of turning Search the web on: the model is searching, said what it found, or why it didn't
 * turn on, or else that choosing another model turned it off.
 */
type WebTest = "searching" | { found: string } | { refusal: string } | { off: string };

/** Whether Ember AI, as `assistant` has it, searches the web. */
const searchesIn = (assistant: Assistant) => assistant.webTools?.includes("search") ?? false;

/** Whether @ember runs on a model, for administrators, and which, or else what Ember AI would add. */
export function AssistantSettings({ assistant, onSetUp, onStopped, onChanged, onFailed }: Props) {
  const [stopping, setStopping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  // Whether Search the web is turning on or off, while it saves.
  const [turningWeb, setTurningWeb] = useState<boolean | null>(null);
  const [webTest, setWebTest] = useState<WebTest | null>(null);
  /** The address of the picture picked for @ember's avatar, shown while it saves. */
  const [pickedAvatar, setPickedAvatar] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const busy = stopping || saving || savingAvatar || turningWeb !== null;
  const people = useContext(PeopleContext);
  const flash = useFlash();
  const mounted = useMounted();

  // The picked picture's address is let go of once the saved one takes its place.
  useEffect(() => () => void (pickedAvatar && URL.revokeObjectURL(pickedAvatar)), [pickedAvatar]);

  // Another tab may change @ember's avatar, which the people directory hears of: Ember AI is read again
  // then, for whether an administrator uploaded the one it has now, but not while a change of the card's
  // own saves. That drops a read begun before, which could answer after the change and show Ember AI as
  // it was. The change's answer has the avatar, or else Ember AI is read again once it's done.
  const listedAvatarUrl = people.get(ASSISTANT_ID)?.avatarUrl;
  const changedElsewhere =
    assistant !== null && !busy && listedAvatarUrl !== undefined && avatarVersionOf(listedAvatarUrl) > avatarVersionOf(assistant.avatarUrl);
  const showRead = useEffectEvent(({ assistant: read }: WorkspaceSettings) => (read ? onChanged(read) : onStopped()));
  const readFailed = useEffectEvent((error: unknown) => onFailed(error));
  useEffect(() => {
    if (!changedElsewhere) return;
    let stopped = false;
    fetchWorkspaceSettings().then(
      (settings) => {
        if (!stopped) showRead(settings);
      },
      (error: unknown) => {
        // A read that's been replaced, or that outlived the card, only reports a session that's ended, which goes to sign in.
        if (!stopped || isSignedOut(error)) readFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [changedElsewhere, listedAvatarUrl]);

  /** Shows Ember AI as `changed` at once, and saves it with `save`, showing it as it was, `shown`, again if it isn't saved. */
  const saveShown = (shown: Assistant, changed: Assistant, save: () => Promise<Assistant>) => {
    setSaving(true);
    onChanged(changed);
    save().then(
      (saved) => {
        onChanged(saved);
        if (mounted.current) setSaving(false);
      },
      (error: unknown) => {
        onChanged(shown);
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

  /**
   * Changes the model that answers everyone, or the most of the dials, by `changes`. Another model may not
   * take the same tools for the web, so choosing one turns Search the web off, which the card then says.
   */
  const change = (shown: Assistant, { model, ...levels }: AssistantChanges) =>
    saveShown(shown, { ...shown, model: model ?? shown.model, most: { ...shown.most, ...levels } }, async () => {
      const saved = await changeAssistantSettings({ ...levels, ...(model && { model }) });
      if (mounted.current && saved.model !== shown.model) setWebTest(searchesIn(shown) && !searchesIn(saved) ? { off: searchTurnedOff(saved.webTools) } : null);
      return saved;
    });

  /** Takes `model` out of the models people can pick. */
  const remove = (shown: Assistant, model: string) =>
    saveShown(shown, { ...shown, models: shown.models.filter(({ id }) => id !== model) }, () => removeAssistantModel(model));

  /** Turns Search the web `on`, once the model has searched, or off, saying what came of it. */
  const turnWebSearch = (on: boolean) => {
    setTurningWeb(on);
    setWebTest(on ? "searching" : null);
    changeWebSearch(on).then(
      ({ assistant, found }) => {
        onChanged(assistant);
        if (!mounted.current) return;
        setTurningWeb(null);
        setWebTest(found === null ? null : { found });
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setTurningWeb(null);
        // What AI Gateway or the model made of searching, or that Ember AI changed meanwhile, which the card says itself.
        if (error instanceof ApiError && [409, 422, 429, 502].includes(error.status)) return setWebTest({ refusal: error.message });
        setWebTest(null);
        onFailed(error);
      },
    );
  };

  /** Saves `file` as @ember's avatar, once a picture is picked. */
  const saveAvatar = (file: File) => {
    if (file.size > MAX_AVATAR_SIZE) return flash("alert", AVATAR_TOO_LARGE);
    setPickedAvatar(URL.createObjectURL(file));
    showAvatar(avatarVariantOf(file).then((variant) => changeAssistantAvatar({ file, variant })), CHANGES_SAVED);
  };

  /** Shows @ember's avatar as `change` saves it, flashing `notice` once it has. */
  function showAvatar(change: Promise<Assistant>, notice?: string) {
    setSavingAvatar(true);
    change.then(
      (saved) => {
        onChanged(saved);
        if (!mounted.current) return;
        setSavingAvatar(false);
        setPickedAvatar(null);
        if (notice) flash("notice", notice);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSavingAvatar(false);
        setPickedAvatar(null);
        onFailed(error);
      },
    );
  }

  /** Opens the setup, whose model, once it's saved, may not be the one the card said searched, or didn't. */
  const setUp = () => {
    setWebTest(null);
    onSetUp();
  };

  const stop = () => {
    if (!confirm(CONFIRM_STOP_ASSISTANT)) return;
    setStopping(true);
    forgetAssistant().then(
      () => {
        onStopped();
        if (mounted.current) setStopping(false);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setStopping(false);
        onFailed(error);
      },
    );
  };

  return (
    <section aria-labelledby="assistant-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <div className="flex items-center gap-x-[1ch] gap-y-4">
        <div className="min-w-0 flex-1">
          <h2 id="assistant-heading" className="text-base font-semibold">
            Ember AI
          </h2>
          <p id="assistant-description" className={NOTE}>
            {assistant === null ? (
              "Ember AI adds @ember, an AI assistant, to every room open to everyone, running on a model you choose through Cloudflare AI Gateway."
            ) : (
              <>
                @ember runs on <strong className="font-semibold wrap-anywhere">{modelName(assistant.model, assistant.models)}</strong> through Cloudflare AI
                Gateway{assistant.models.length > 1 && ", or on the model each person picks"}.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={assistant !== null && !stopping}
          onCheckedChange={(on) => (on ? setUp() : stop())}
          disabled={busy}
          aria-labelledby="assistant-heading"
          aria-describedby="assistant-description"
        />
      </div>
      {assistant !== null && (
        <>
          <p className={NOTE}>{WHAT_EMBER_SENDS}</p>
          <div>
            <button type="button" onClick={setUp} disabled={busy} className={BUTTON}>
              Change
            </button>
          </div>
          <Avatar
            src={pickedAvatar ?? latestAvatarUrl(assistant.avatarUrl, listedAvatarUrl)}
            uploaded={assistant.avatar}
            disabled={busy}
            onChoose={saveAvatar}
            // Use Ember's flame: no confirmation first, and no notice after, as Remove icon.
            onRemove={() => showAvatar(removeAssistantAvatar())}
          />
          <Models
            assistant={assistant}
            disabled={busy}
            onChoose={(model) => change(assistant, { model })}
            onRemove={(model) => remove(assistant, model)}
            onAdd={() => setAdding(true)}
          />
          <WebSearch assistant={assistant} turning={turningWeb} test={webTest} disabled={busy} onTurn={turnWebSearch} onSetUp={setUp} />
          <div className="flex flex-col gap-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">Limits</h3>
              <p className={NOTE}>{LIMITS_EXPLAINED}</p>
            </div>
            <LevelDials name="assistant-most" levels={assistant.most} disabled={busy} onChange={(changes) => change(assistant, changes)} />
          </div>
          {adding && <AddAssistantModel assistant={assistant} onAdded={onChanged} onClose={() => setAdding(false)} onFailed={onFailed} />}
        </>
      )}
    </section>
  );
}

/** @ember's avatar as the card last saw it, or as the people directory has it, when another tab has changed it since. */
const latestAvatarUrl = (shown: string, listed: string | undefined) => (listed && avatarVersionOf(listed) > avatarVersionOf(shown) ? listed : shown);

/**
 * @ember's avatar, while Ember AI is on: the picture `src` in a circle with a camera on its corner, which
 * picks a picture to replace it at once, as your avatar on your profile, and Use Ember's flame, which
 * takes away the picture an administrator `uploaded`, where one did.
 */
function Avatar({ src, uploaded, disabled, onChoose, onRemove }: { src: string; uploaded: boolean; disabled: boolean; onChoose: (file: File) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-x-[2ch] border-t pt-4">
      <PictureField id="assistant_avatar" src={src} alt="@ember's avatar" label="Upload @ember's avatar" size="small" disabled={disabled} onChoose={onChoose} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div>
          <h3 className="text-sm font-semibold">Avatar</h3>
          <p id="assistant_avatar-description" className={NOTE}>
            {uploaded ? UPLOADED_AVATAR_EXPLAINED : AVATAR_EXPLAINED}
          </p>
        </div>
        {uploaded && (
          <button type="button" disabled={disabled} onClick={onRemove} className={BUTTON}>
            Use Ember's flame
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The models people can pick, in the order they were added, each a radio button that chooses it to
 * answer everyone else, with a Remove for each but that one, and Add a model under them, until there are
 * as many as there can be.
 */
function Models({
  assistant,
  disabled,
  onChoose,
  onRemove,
  onAdd,
}: {
  assistant: Assistant;
  disabled: boolean;
  onChoose: (model: string) => void;
  onRemove: (model: string) => void;
  onAdd: () => void;
}) {
  const full = assistant.models.length >= MAX_ASSISTANT_MODELS;
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div>
        <h3 id="assistant-models-heading" className="text-sm font-semibold">
          Models
        </h3>
        <p id="assistant-models-description" className={NOTE}>
          {MODELS_EXPLAINED}
        </p>
      </div>
      <fieldset aria-labelledby="assistant-models-heading" aria-describedby="assistant-models-description" className="flex min-w-0 flex-col gap-1">
        {assistant.models.map(({ id, name }) => (
          <div key={id} className="flex items-center gap-[1ch]">
            <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 has-disabled:cursor-default">
              <input
                type="radio"
                name="assistant-model"
                value={id}
                checked={assistant.model === id}
                disabled={disabled}
                onChange={() => onChoose(id)}
                className="size-4 flex-none accent-foreground"
              />
              <span className="min-w-0 wrap-anywhere">{name}</span>
            </label>
            {assistant.model !== id && (
              <button type="button" aria-label={`Remove ${name}`} disabled={disabled} onClick={() => onRemove(id)} className={BUTTON}>
                Remove
              </button>
            )}
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-[1ch] gap-y-2">
        <button type="button" disabled={disabled || full} onClick={onAdd} aria-describedby={full ? "assistant-models-full" : undefined} className={BUTTON}>
          Add a model
        </button>
        {full && (
          <p id="assistant-models-full" className={NOTE}>
            {MODELS_FULL}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Search the web, while Ember AI is on: what @ember does on the web, its switch, shown as it's `turning`
 * while it saves, and what came of turning it on, or of choosing another model, its `test`. For a model
 * that can't search, it says so, and its switch opens the setup, where another can be chosen.
 */
function WebSearch({
  assistant,
  turning,
  test,
  disabled,
  onTurn,
  onSetUp,
}: {
  assistant: Assistant;
  turning: boolean | null;
  test: WebTest | null;
  disabled: boolean;
  onTurn: (on: boolean) => void;
  onSetUp: () => void;
}) {
  const { webTools, model, models } = assistant;
  const name = modelName(model, models);
  const searches = searchesIn(assistant);
  const note = webTools === null ? cannotSearchWith(name) : searches ? webSearchOn(webTools, models) : WEB_SEARCH_OFF;
  return (
    <div className="border-t pt-4">
      <div className="flex items-center gap-x-[1ch]">
        <div className="min-w-0 flex-1">
          <h3 id="web-search-heading" className="text-sm font-semibold">
            Search the web
          </h3>
          <p id="web-search-description" className={NOTE}>
            {note}
          </p>
        </div>
        <Switch
          checked={turning ?? searches}
          onCheckedChange={(on) => (webTools === null ? onSetUp() : onTurn(on))}
          disabled={disabled}
          aria-labelledby="web-search-heading"
          aria-describedby="web-search-description"
        />
      </div>
      <p role="status" className={cn(NOTE, "mt-2 wrap-anywhere empty:mt-0", test !== null && test !== "searching" && ("found" in test ? "text-positive" : "refusal" in test && "text-negative"))}>
        {test === "searching" ? searchingWith(name) : test !== null && ("found" in test ? `It searched the web and said: ${test.found}` : "refusal" in test ? test.refusal : test.off)}
      </p>
    </div>
  );
}
