import axios from "axios";

const DEFAULT_API_URL = "http://localhost:3000";
const DEFAULT_TRANSCRIBE_URL = process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL || "http://localhost:8000";

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add Clerk user ID to all requests
export const setAuthHeader = (clerkId: string) => {
  apiClient.defaults.headers.common["x-clerk-id"] = clerkId;
};

// API functions
export const api = {
  // Users
  getMe: () => apiClient.get("/users/me"),
  createUser: (isParalyzed: boolean) =>
    apiClient.post("/users", { isParalyzed }),
  searchUsers: (query: string) =>
    apiClient.get("/users/search", { params: { q: query } }),

  // Contacts
  getContacts: () => apiClient.get("/contacts"),
  addContact: (contactClerkId: string, nickname?: string) =>
    apiClient.post("/contacts", { contactClerkId, nickname }),

  // Conversations
  getConversations: () => apiClient.get("/conversations"),
  getMessages: (conversationId: number, limit = 50, offset = 0) =>
    apiClient.get(`/conversations/${conversationId}/messages`, {
      params: { limit, offset },
    }),
  getMessagesByContact: (contactId: string, limit = 50, offset = 0) =>
    apiClient.get(`/conversations/with/${contactId}/messages`, {
      params: { limit, offset },
    }),

  transcribeAudio: (audioFile: File) => {
    const formData = new FormData();
    formData.append("file", audioFile);

    const endpointBase = process.env.NEXT_PUBLIC_TRANSCRIBE_API_URL || DEFAULT_TRANSCRIBE_URL;
    const endpoint = new URL("/audio/transcribe", endpointBase).toString();

    return axios.post(endpoint, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
        Accept: "application/json",
      },
    });
  },

  // Chat AI Options
  getChatOptions: (message: string) => {
    const endpointBase = process.env.NEXT_PUBLIC_TRANSCRIBE_API_URL || DEFAULT_TRANSCRIBE_URL;
    const endpoint = new URL("/chat/options", endpointBase).toString();

    return axios.post(endpoint, { message }, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  },
};