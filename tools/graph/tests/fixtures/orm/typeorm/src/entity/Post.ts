import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn } from "typeorm"
import { User } from "./User"
import { Tag } from "./Tag"

@Entity("post")
export class Post {
    @PrimaryGeneratedColumn()
    id: number

    @Index("IDX_post_title")
    @Column()
    title: string

    @Column({ type: "timestamp with time zone", nullable: true })
    publishedAt: Date | null

    @ManyToOne(() => User, (user) => user.posts, { onDelete: "CASCADE" })
    author: User

    @ManyToMany(() => Tag)
    @JoinTable()
    tags: Tag[]
}
