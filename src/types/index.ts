export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type Status   = 'not_started' | 'in_progress' | 'done' | 'blocked'
export type ItemType = 'goal' | 'feature' | 'story' | 'task' | 'subtask'

export interface Project {
  id: string
  name: string
  description?: string
  color: string
  created_at: string
  updated_at: string
}

export interface RoadmapItem {
  id: string
  project_id: string
  parent_id?: string | null
  type: ItemType
  name: string
  description?: string
  start_date?: string | null
  end_date?: string | null
  priority: Priority
  status: Status
  position: number
  color?: string | null
  created_at: string
  updated_at: string
  children?: RoadmapItem[]
}
