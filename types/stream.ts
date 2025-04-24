export interface DataPartValue {
  citations?: string[];
  type?: string;
  content?: string;
  finishReason?: string;
  sandboxType?: 'persistent-sandbox' | 'temporary-sandbox';
  elapsed_secs?: number;
  chatTitle?: string | null;
}
