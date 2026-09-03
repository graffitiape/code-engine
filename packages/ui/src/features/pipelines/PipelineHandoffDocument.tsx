import { createSignal } from "solid-js";
import { Icon, MarkdownText } from "../../design";
import type { FileLinkTarget } from "../../design/MarkdownText";

interface PipelineHandoffDocumentProps {
  text: string;
  label: string;
  description: string;
  open?: boolean;
  onOpenFile: (target: FileLinkTarget) => void;
}

export function PipelineHandoffDocument(props: PipelineHandoffDocumentProps) {
  const [open, setOpen] = createSignal(Boolean(props.open));

  return (
    <details
      class="pipeline-handoff-document"
      open={open()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        role="button"
        aria-expanded={open()}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <span><Icon name="file" size={13} />{props.label}</span>
        <small>{props.description}</small>
      </summary>
      <MarkdownText
        class="pipeline-handoff-document-output"
        text={props.text}
        onOpenFile={props.onOpenFile}
      />
    </details>
  );
}
