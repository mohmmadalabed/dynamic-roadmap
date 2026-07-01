export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type Status   = 'not_started' | 'in_progress' | 'done' | 'blocked'
export type ItemType = 'goal' | 'feature' | 'story' | 'task' | 'subtask'

export type ProjectType    = 'product' | 'business'
export type DepartmentType = 'product' | 'marketing' | 'sales'
export type SectionType    = 'obj' | 'kr' | 'act' | 'del' | 'res' | 'cost'

export interface Project {
  id: string
  name: string
  description?: string
  color: string
  type?: ProjectType
  owner_id?: string | null
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

export interface BusinessPhase {
  id: string
  project_id: string
  name: string
  order_index: number
  start_date?: string | null
  end_date?: string | null
  created_at: string
}

export interface BusinessOKRItem {
  id: string
  phase_id: string
  department: DepartmentType
  section_type: SectionType
  content: string
  order_index: number
  created_at: string
}
