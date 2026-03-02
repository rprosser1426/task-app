"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { TaskNote } from "./types";
import { createTaskNote, fetchTaskNotes } from "./notesApi";

import DOMPurify from "dompurify";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";

type Props = {
    open: boolean;
    taskId: string | null;
    taskTitle?: string;
    onClose(): void;
    displayUserName(id: string): string;

    busy: boolean; // accepted for consistency (not required inside)
    setBusyText(text: string | null): void;

    onNotesCountChange?: (taskId: string, count: number) => void;
};

function formatDate(iso: string) {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

/**
 * Heuristic: treat as HTML only if it contains an HTML tag.
 * Old notes (plain text) will not match this and will render as plain text.
 */
function looksLikeHtml(s: string) {
    return /<\/?[a-z][\s\S]*>/i.test(s);
}

/**
 * Render helper:
 * - If HTML: sanitize + render
 * - Else: render plain text (safe)
 */
function NoteBody({ value }: { value: string }) {
    const isHtml = looksLikeHtml(value);

    const safeHtml = useMemo(() => {
        if (!isHtml) return "";
        // TipTap generates safe-ish HTML, but we STILL sanitize before injecting.
        return DOMPurify.sanitize(value, {
            USE_PROFILES: { html: true },
        });
    }, [value, isHtml]);

    if (!isHtml) {
        return <div style={styles.noteTextPlain}>{value}</div>;
    }

    // ✅ give HTML notes a wrapper class so our global CSS can style lists
    return (
        <div
            className="note-html"
            style={styles.noteTextHtml}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
    );
}

function ToolbarButton({
    onClick,
    active,
    disabled,
    children,
    title,
}: {
    onClick(): void;
    active?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    title?: string;
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            disabled={disabled}
            style={{
                ...styles.tbBtn,
                ...(active ? styles.tbBtnActive : null),
                ...(disabled ? styles.tbBtnDisabled : null),
            }}
        >
            {children}
        </button>
    );
}

export default function TaskNotesModal({
    open,
    taskId,
    taskTitle,
    onClose,
    displayUserName,
    setBusyText,
    onNotesCountChange,
}: Props) {
    const [notes, setNotes] = useState<TaskNote[]>([]);
    const [loadingLocal, setLoadingLocal] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const isReading = expandedId !== null;
    const [hasContent, setHasContent] = useState(false);
    const [showComposer, setShowComposer] = useState(false);

    // TipTap editor (Word-like)
    const editor = useEditor({
        extensions: [StarterKit, Underline],
        content: "",
        immediatelyRender: false,
        editorProps: {
            attributes: {
                style:
                    "min-height: 110px; max-height: 220px; overflow-y: auto; padding: 12px; padding-bottom: 64px; outline: none; white-space: pre-wrap;",
            },
        },
        onUpdate({ editor }) {
            const html = editor.getHTML().trim();

            const empty =
                html === "" ||
                html === "<p></p>" ||
                html === "<p><br></p>" ||
                html.replace(/\s+/g, "") === "<p></p>";

            setHasContent(!empty);
        },
    });

    async function refresh() {
        if (!taskId) return;
        setError(null);
        setLoadingLocal(true);
        setBusyText("Loading notes…");
        try {
            const list = await fetchTaskNotes(taskId);
            setNotes(list);
            onNotesCountChange?.(taskId, list.length);
        } catch (e: any) {
            setError(e?.message || "Failed to load notes.");
        } finally {
            setLoadingLocal(false);
            setBusyText(null);
        }
    }

    useEffect(() => {
        if (open && taskId) {
            void refresh();
        } else {
            setNotes([]);
            setError(null);
            setLoadingLocal(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, taskId]);

    useEffect(() => {
        if (open) setShowComposer(false);
    }, [open, taskId]);

    // When opening a specific task, clear editor
    useEffect(() => {
        if (!open) return;
        if (!editor) return;
        editor.commands.setContent("");
    }, [open, taskId, editor]);

    useEffect(() => {
        if (showComposer && editor) {
            setTimeout(() => editor.chain().focus().run(), 0);
        }
    }, [showComposer, editor]);

    async function onSave() {
        if (!taskId) return;
        if (!editor) return;

        const html = editor.getHTML().trim();

        // TipTap empty content is usually "<p></p>" (or similar). Treat as empty.
        const empty =
            html === "" ||
            html === "<p></p>" ||
            html === "<p><br></p>" ||
            html.replace(/\s+/g, "") === "<p></p>";

        if (empty) return;

        setError(null);
        setSaved(false);
        setSaving(true);
        setBusyText("Saving note…");

        try {
            // ✅ Store HTML in the SAME "note" column
            await createTaskNote(taskId, html);

            editor.commands.setContent("");
            setHasContent(false);
            await refresh();
            setShowComposer(false);

            setSaved(true);
            setTimeout(() => setSaved(false), 1200);
        } catch (e: any) {
            setError(e?.message || "Failed to save note.");
        } finally {
            setSaving(false);
            setBusyText(null);
        }
    }

    if (!open) return null;

    return (
        <div style={styles.backdrop} role="dialog" aria-modal="true">
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div style={styles.header}>
                    <div style={styles.title}>{taskTitle || "Notes"}</div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {expandedId && (
                            <button
                                type="button"
                                style={styles.backToWritingBtn}
                                onClick={() => setExpandedId(null)}
                            >
                                Back to history
                            </button>
                        )}

                        <button
                            type="button"
                            style={{
                                ...styles.backToWritingBtn,
                                ...(expandedId ? styles.backToWritingBtnDisabled : null),
                            }}
                            onClick={() => setShowComposer((v) => !v)}
                            disabled={!!expandedId}
                        >
                            {showComposer ? "Hide editor" : "Enter new note"}
                        </button>

                        <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
                            ✕
                        </button>
                    </div>
                </div>

                {saving && (
                    <div style={styles.savingOverlay} aria-live="polite" aria-busy="true">
                        <div style={styles.savingBox}>
                            <div style={styles.savingTitle}>Saving…</div>
                            <div style={styles.savingSub}>Please wait.</div>
                        </div>
                    </div>
                )}

                {saved && !saving && (
                    <div style={styles.savedToast} aria-live="polite">
                        Saved ✅
                    </div>
                )}

                <div
                    style={{
                        ...styles.body,
                        gridTemplateRows: showComposer && !expandedId ? "minmax(0, 1fr) auto" : "1fr",
                    }}
                >
                    {error && <div style={styles.error}>{error}</div>}

                    <div style={styles.history}>
                        {loadingLocal ? (
                            <div style={styles.muted}>Loading…</div>
                        ) : notes.length === 0 ? (
                            <div style={styles.muted}>No notes yet.</div>
                        ) : (
                            (expandedId ? notes.filter((n) => n.id === expandedId) : notes).map((n) => {
                                const isOpen = expandedId === n.id;

                                return (
                                    <div key={n.id} style={styles.noteRow}>
                                        <div style={styles.noteMeta}>
                                            <span style={styles.noteAuthor}>{displayUserName(n.author_id)}</span>
                                            <span style={styles.noteDate}>{formatDate(n.created_at)}</span>

                                            <div style={{ flex: 1 }} />

                                            <button
                                                type="button"
                                                style={styles.noteToggleBtn}
                                                onClick={() => setExpandedId(isOpen ? null : n.id)}
                                            >
                                                {isOpen ? "Collapse" : "Expand"}
                                            </button>
                                        </div>

                                        <div style={isOpen ? styles.noteBodyOpen : styles.noteBodyCollapsed}>
                                            <NoteBody value={String((n as any).note ?? "")} />
                                        </div>

                                        {!isOpen && <div style={styles.fadeOut} />}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {showComposer && !expandedId && (
                        <div style={styles.composer}>
                            {/* Toolbar */}
                            <div style={styles.toolbar}>
                                <ToolbarButton
                                    title="Bold"
                                    onClick={() => editor?.chain().focus().toggleBold().run()}
                                    active={!!editor?.isActive("bold")}
                                    disabled={!editor}
                                >
                                    <b>B</b>
                                </ToolbarButton>

                                <ToolbarButton
                                    title="Italic"
                                    onClick={() => editor?.chain().focus().toggleItalic().run()}
                                    active={!!editor?.isActive("italic")}
                                    disabled={!editor}
                                >
                                    <i>I</i>
                                </ToolbarButton>

                                <ToolbarButton
                                    title="Underline"
                                    onClick={() => editor?.chain().focus().toggleUnderline().run()}
                                    active={!!editor?.isActive("underline")}
                                    disabled={!editor}
                                >
                                    <span style={{ textDecoration: "underline" }}>U</span>
                                </ToolbarButton>

                                <div style={styles.toolbarDivider} />

                                <ToolbarButton
                                    title="Bulleted list"
                                    onClick={() => editor?.chain().focus().toggleBulletList().run()}
                                    active={!!editor?.isActive("bulletList")}
                                    disabled={!editor}
                                >
                                    • List
                                </ToolbarButton>

                                <ToolbarButton
                                    title="Numbered list"
                                    onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                                    active={!!editor?.isActive("orderedList")}
                                    disabled={!editor}
                                >
                                    1. List
                                </ToolbarButton>

                                <div style={{ flex: 1 }} />

                                <ToolbarButton
                                    title="Clear formatting"
                                    onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
                                    disabled={!editor}
                                >
                                    Clear
                                </ToolbarButton>
                            </div>

                            {/* Editor */}
                            <div style={styles.editorShell}>
                                <div className="tiptap">
                                    <EditorContent editor={editor} />
                                </div>
                            </div>

                            <div style={styles.actions}>
                                <button
                                    style={{
                                        ...styles.btnPrimary,
                                        ...(saving || !editor || !hasContent
                                            ? styles.btnPrimaryDisabled
                                            : null),
                                    }}
                                    onClick={onSave}
                                    disabled={saving || !editor || !hasContent}
                                >
                                    {saving ? "Saving…" : "Save"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ✅ IMPORTANT: global CSS so lists actually show bullets/numbers */}
            <style jsx global>{`
        .tiptap ul {
          list-style: disc !important;
          padding-left: 1.5rem !important;
          margin: 0.5rem 0 !important;
        }
        .tiptap ol {
          list-style: decimal !important;
          padding-left: 1.5rem !important;
          margin: 0.5rem 0 !important;
        }
        .tiptap li {
          margin: 0.2rem 0 !important;
        }

        /* Also apply to rendered HTML notes in history */
        .note-html ul {
          list-style: disc !important;
          padding-left: 1.5rem !important;
          margin: 0.5rem 0 !important;
        }
        .note-html ol {
          list-style: decimal !important;
          padding-left: 1.5rem !important;
          margin: 0.5rem 0 !important;
        }
        .note-html li {
          margin: 0.2rem 0 !important;
        }
      `}</style>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
        padding: 18,
    },
    modal: {
        position: "relative",
        width: "min(920px, 96vw)",
        maxHeight: "86vh",
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(15, 23, 42, 0.98)",
        boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
        color: "#e5e7eb",
        display: "grid",
        gridTemplateRows: "auto 1fr",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
    },
    title: { fontSize: 16, fontWeight: 900 },
    closeBtn: {
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#e5e7eb",
        padding: "8px 10px",
        cursor: "pointer",
        fontWeight: 800,
    },
    body: {
        padding: 16,
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr) auto",
        gap: 12,
        minHeight: 0,
    },
    history: {
        minHeight: 0,
        overflowY: "auto",
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.04)",
    },
    noteRow: {
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
    },

    backToWritingBtn: {
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.10)",
        color: "#e5e7eb",
        padding: "8px 12px",
        cursor: "pointer",
        fontWeight: 900,
        fontSize: 12,
        boxShadow: "0 8px 18px rgba(0,0,0,0.25)",
    },

    backToWritingBtnDisabled: {
        opacity: 0.45,
        cursor: "not-allowed",
        boxShadow: "none",
    },

    noteToggleBtn: {
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#e5e7eb",
        padding: "6px 10px",
        cursor: "pointer",
        fontWeight: 800,
        fontSize: 12,
    },

    noteBodyCollapsed: {
        position: "relative",
        maxHeight: 84,
        overflow: "hidden",
    },

    noteBodyOpen: {
        maxHeight: "none",
        overflow: "visible",
    },

    fadeOut: {
        marginTop: -28,
        height: 28,
        background:
            "linear-gradient(to bottom, rgba(15,23,42,0), rgba(15,23,42,0.98))",
        pointerEvents: "none",
    },

    noteMeta: { display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6 },
    noteAuthor: { fontWeight: 900 },
    noteDate: { fontSize: 12, opacity: 0.8 },

    // Plain text note display
    noteTextPlain: { whiteSpace: "pre-wrap", lineHeight: 1.35, opacity: 0.95 },

    // HTML note display (TipTap output)
    noteTextHtml: {
        lineHeight: 1.4,
        opacity: 0.98,
    },

    composer: {
        display: "grid",
        gap: 10,
        paddingTop: 8,
        flexShrink: 0,

        // ✅ NEW: helps sticky footer look right
        paddingBottom: 6,
    },

    toolbar: {
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.04)",
    },
    toolbarDivider: {
        width: 1,
        height: 18,
        background: "rgba(255,255,255,0.18)",
        margin: "0 4px",
    },
    tbBtn: {
        padding: "6px 10px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#e5e7eb",
        cursor: "pointer",
        fontWeight: 800,
        fontSize: 12,
        lineHeight: 1,
        userSelect: "none",
    },
    tbBtnActive: {
        border: "1px solid rgba(59,130,246,0.55)",
        background: "rgba(59,130,246,0.22)",
    },
    tbBtnDisabled: {
        opacity: 0.55,
        cursor: "not-allowed",
    },

    editorShell: {
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(0,0,0,0.22)",
        color: "#e5e7eb",
        overflow: "hidden",

        // ✅ NEW: keep editor from growing forever
        maxHeight: 220, // adjust (200–280 is usually perfect)
    },

    actions: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 10,

        // ✅ NEW: keep Save visible
        position: "sticky",
        bottom: 0,
        paddingTop: 10,
        paddingBottom: 10,
        background: "rgba(15, 23, 42, 0.98)", // same as modal background
        borderTop: "1px solid rgba(255,255,255,0.10)",
        zIndex: 5,
    },


    btnPrimary: {
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid rgba(59,130,246,0.75)",
        background: "rgba(59,130,246,0.55)",
        color: "#ffffff",
        cursor: "pointer",
        fontWeight: 900,
        boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
    },

    btnPrimaryDisabled: {
        opacity: 0.45,
        cursor: "not-allowed",
        boxShadow: "none",
    },

    error: {
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(239,68,68,0.35)",
        background: "rgba(239,68,68,0.12)",
        color: "rgb(254,202,202)",
        fontWeight: 700,
    },

    savingOverlay: {
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
    },
    savingBox: {
        backgroundColor: "rgba(10, 15, 30, 0.95)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 12,
        padding: "14px 16px",
        minWidth: 220,
        boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
        textAlign: "center",
    },
    savingTitle: {
        fontSize: 16,
        fontWeight: 700,
        color: "#e5e7eb",
        marginBottom: 6,
    },
    savingSub: {
        fontSize: 13,
        color: "rgba(229,231,235,0.8)",
    },
    savedToast: {
        position: "absolute",
        right: 14,
        top: 14,
        backgroundColor: "rgba(10, 15, 30, 0.92)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 10,
        padding: "8px 10px",
        color: "#e5e7eb",
        fontSize: 13,
        zIndex: 60,
    },
    muted: { opacity: 0.8, fontSize: 13 },
};