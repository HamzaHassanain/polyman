import { Box, Static } from 'ink';
import type { Item } from '../store.js';
import { MessageView } from './MessageView.js';
import { Welcome } from './Welcome.js';

type Row = { kind: 'welcome'; id: 0 } | Item;

/**
 * The finished part of the chat, in Ink `<Static>`: each row is printed once
 * into the normal scrollback and never drawn again. The welcome box is the
 * first row.
 */
export function Transcript({
  items,
  folder,
  model,
  columns,
}: {
  items: Item[];
  /** The problem folder, or the folder the chat started in. */
  folder: string;
  model: string;
  /** The terminal width when the chat started. */
  columns: number;
}) {
  const rows: Row[] = [{ kind: 'welcome', id: 0 }, ...items];
  return (
    <Static items={rows} style={{ width: '100%' }}>
      {row =>
        row.kind === 'welcome' ? (
          <Welcome
            key="welcome"
            folder={folder}
            model={model}
            columns={columns}
          />
        ) : (
          <Box key={row.id} marginBottom={1}>
            <MessageView item={row} />
          </Box>
        )
      }
    </Static>
  );
}
