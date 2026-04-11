import { Types } from 'mongoose';

export type UserPlan = 'free' | 'pro' | 'team' | 'enterprise';
export type UserTheme = 'system' | 'dark' | 'light';

export interface IUserPreferences {
  theme: UserTheme;
  cursorColor: string;
  defaultTool: string;
  gridEnabled: boolean;
  snapToGrid: boolean;
  fontSize: number;
}

export interface IUser {
  _id: Types.ObjectId;
  fId: string;           // Firebase UID
  email: string;
  fullName: string;
  avatarUrl: string | null;
  avatarId: number;
  plan: UserPlan;
  preferences: IUserPreferences;
  canvasCount: number;
  isActive: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPublicUser {
  _id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  avatarId: number;
  plan: UserPlan;
}

export type CanvasRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface ICollaborator {
  user: Types.ObjectId;
  role: 'viewer' | 'editor' | 'commenter';
  addedAt: Date;
  addedBy: Types.ObjectId;
}

export interface IShareToken {
  token: string;
  role: 'viewer' | 'editor' | 'commenter';
  label: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface ICanvasSettings {
  gridSize: number;
  snapToGrid: boolean;
  backgroundColor: string;
  allowComments: boolean;
  allowAnonymousView: boolean;
  aiEnabled: boolean;
}

export type CanvasCategory =
  | 'flowchart'
  | 'architecture'
  | 'brainstorm'
  | 'wireframe'
  | 'erd'
  | 'other';

export interface ICanvas {
  _id: Types.ObjectId;
  title: string;
  description: string;
  owner: Types.ObjectId;
  collaborators: ICollaborator[];
  shareTokens: IShareToken[];
  isPublic: boolean;
  thumbnail: string | null;
  thumbnailKey: string | null;
  thumbnailUpdatedAt: Date | null;
  elementCount: number;
  activeUserCount: number;
  tags: string[];
  category: CanvasCategory;
  lastViewport: { x: number; y: number; zoom: number };
  currentBranch: Types.ObjectId | null;
  defaultBranch: Types.ObjectId | null;
  forkOf: Types.ObjectId | null;
  forkSnapshotId: Types.ObjectId | null;
  settings: ICanvasSettings;
  archivedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICanvasWithRole extends ICanvas {
  myRole: CanvasRole;
}

export interface IBranch {
  _id: Types.ObjectId;
  canvasId: Types.ObjectId;
  name: string;
  baseSnapshotId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  mergedAt: Date | null;
  parentBranchId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
