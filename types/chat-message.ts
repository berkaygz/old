import type { Tables } from '@/supabase/types';
import type { FilePart, TextPart } from 'ai';

export interface ChatMessage {
  message: Tables<'messages'>;
  fileItems: Tables<'file_items'>[];
  feedback?: Tables<'feedback'>;
  attachments?: Tables<'file_items'>[];
}

export interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type MessageContent = ImageContent | TextPart | FilePart;

export interface BuiltChatMessage {
  role: string;
  content: string | MessageContent[];
  attachments?: Tables<'file_items'>[];
}
