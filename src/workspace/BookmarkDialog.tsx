import type { FormEventHandler } from "react";

export type BookmarkDraft = { id?: string; title: string; page: number };

type BookmarkDialogProps = {
  bookmarkDraft: BookmarkDraft;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onChange: (draft: BookmarkDraft) => void;
  onClose: () => void;
};

export function BookmarkDialog({
  bookmarkDraft, onSubmit, onChange, onClose,
}: BookmarkDialogProps) {
  return (
    <div className="modal-backdrop">
      <form
        className="settings-dialog"
        role="dialog"
        aria-label="Bookmark"
        onSubmit={onSubmit}
      >
        <h2>Keep your place</h2>
        <p>Page {bookmarkDraft.page} · saved locally for this document</p>
        <label>
          Bookmark name
          <input
            autoFocus
            className="bookmark-name"
            aria-label="Bookmark name"
            value={bookmarkDraft.title}
            maxLength={160}
            onChange={(e) =>
              onChange({ ...bookmarkDraft, title: e.target.value })
            }
          />
        </label>
        <button
          type="submit"
          className="primary"
          disabled={!bookmarkDraft.title.trim()}
        >
          Save bookmark
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </div>
  );
}
