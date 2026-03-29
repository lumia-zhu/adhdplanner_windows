'use client'

import UserCard, { type UserCardData } from './UserCard'

interface Props {
  users: UserCardData[]
  onSelectUser: (userId: string) => void
}

export default function UserCardGrid({ users, onSelectUser }: Props) {
  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        暂无用户数据
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
      {users.map(u => (
        <UserCard
          key={u.userId}
          data={u}
          onClick={() => onSelectUser(u.userId)}
        />
      ))}
    </div>
  )
}
