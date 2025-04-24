import type { Tables } from '@/supabase/types';
import { createSupabaseAdminClient } from '@/lib/server/server-utils';
import type { BuiltChatMessage } from '@/types/chat-message';
import type { MessageContent } from '@/types/chat-message';
import type { TextPart, FilePart } from 'ai';

export function buildDocumentsText(fileItems: Tables<'file_items'>[]) {
  const fileGroups: Record<
    string,
    { id: string; name: string; content: string[] }
  > = fileItems.reduce(
    (
      acc: Record<string, { id: string; name: string; content: string[] }>,
      item: Tables<'file_items'>,
    ) => {
      if (!acc[item.file_id]) {
        acc[item.file_id] = {
          id: item.file_id,
          name: item.name || 'unnamed file',
          content: [],
        };
      }
      acc[item.file_id].content.push(item.content);
      return acc;
    },
    {},
  );

  const documents = Object.values(fileGroups)
    .map((file: any) => {
      return `<document id="${file.id}">
<source>${file.name}</source>
<document_content>${file.content.join('\n\n')}</document_content>
</document>`;
    })
    .join('\n\n');

  return `<documents>\n${documents}\n</documents>`;
}

/**
 * Process PDF file items directly to get file contents
 * @param supabaseAdmin - The Supabase admin client
 * @param fileItem - The file item to process
 * @param userId - User ID for authorization
 * @returns PDF file object or null
 */
export async function processPdfFileItem(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  fileItem: Tables<'file_items'>,
  userId: string,
) {
  try {
    // Check if file might be a PDF based on name
    if (!fileItem.name || !fileItem.name.toLowerCase().endsWith('.pdf')) {
      return null;
    }

    // Get the full file metadata
    const { data: fileMetadata, error: metadataError } = await supabaseAdmin
      .from('files')
      .select('*')
      .eq('id', fileItem.file_id)
      .single();

    if (metadataError || !fileMetadata) {
      return null;
    }

    // Check authorization
    if (fileMetadata.user_id !== userId) {
      return null;
    }

    // Check if it's a PDF
    if (
      fileMetadata.type !== 'application/pdf' &&
      !fileMetadata.name.toLowerCase().endsWith('.pdf')
    ) {
      return null;
    }

    // Download the file
    const { data: file, error: fileError } = await supabaseAdmin.storage
      .from('files')
      .download(fileMetadata.file_path);

    if (fileError || !file) {
      return null;
    }

    // Convert to buffer for PDF handling
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      type: 'file' as const,
      data: buffer,
      mimeType: 'application/pdf',
      filename: fileMetadata.name,
    };
  } catch (error) {
    console.error('Error processing PDF file item:', error);
    return null;
  }
}

/**
 * Processes message content and attachments, handling different attachment types appropriately
 * @param messages - The chat messages to process
 * @param userId - The user ID for authorization
 * @returns The processed messages with attachments included
 */
export async function processMessageContentWithAttachments(
  messages: BuiltChatMessage[],
  userId?: string,
): Promise<BuiltChatMessage[]> {
  if (!messages.length) return messages;

  // Create a copy to avoid mutating the original
  let processedMessages = [...messages];

  // Exit early if we don't have a valid user ID
  if (!userId) {
    return processedMessages;
  }

  try {
    // Create admin client to access database
    const supabaseAdmin = createSupabaseAdminClient();

    // Collect all file IDs from all messages first
    const allFileIds = processedMessages
      .flatMap((m) => (m.attachments ?? []).map((a) => a.file_id))
      .filter(Boolean);

    // Make a single batch query for all file items
    const { data: allFileItems } = await supabaseAdmin
      .from('file_items')
      .select('*')
      .in('file_id', allFileIds);

    // Process each message
    for (const message of processedMessages) {
      // Process attachments if they exist in the message
      if (message.attachments && Array.isArray(message.attachments)) {
        // Filter file items for this specific message
        const fileItems =
          allFileItems?.filter((fi) =>
            (message.attachments ?? []).some((a) => a.file_id === fi.file_id),
          ) ?? [];

        if (fileItems.length > 0) {
          // Process files in the order they appear in attachments
          const processedContent: MessageContent[] = [];
          let hasPdfAttachments = false;

          // First add the original content if it's a string
          if (typeof message.content === 'string') {
            processedContent.push({
              type: 'text',
              text: message.content,
            } as TextPart);
          } else if (Array.isArray(message.content)) {
            processedContent.push(...message.content);
          }

          // Process each attachment in order
          for (const attachment of message.attachments) {
            if (!attachment.file_id) continue;

            const fileItem = fileItems.find(
              (item) => item.file_id === attachment.file_id,
            );
            if (!fileItem) continue;

            // Check if it's a PDF
            const pdfFile = await processPdfFileItem(
              supabaseAdmin,
              fileItem,
              userId,
            );
            if (pdfFile) {
              processedContent.push(pdfFile as FilePart);
              hasPdfAttachments = true;
            } else if (!hasPdfAttachments) {
              // If it's not a PDF and we haven't found any PDFs yet,
              // add it to the document text
              const documentsText = buildDocumentsText([fileItem]);
              processedContent.push({
                type: 'text',
                text: documentsText,
              } as TextPart);
            }
          }

          // Update the message content with the processed content
          message.content = processedContent;
        }
      }
    }

    // Remove attachments from all messages after processing
    processedMessages = processedMessages.map(
      ({ attachments, ...messageWithoutAttachments }) =>
        messageWithoutAttachments,
    );

    return processedMessages;
  } catch (error) {
    console.error('Error processing message attachments:', error);
  }

  return processedMessages;
}
