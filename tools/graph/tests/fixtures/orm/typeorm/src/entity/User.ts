import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm"
import { Post } from "./Post"

@Entity()
export class User {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ length: 200, unique: true })
    email: string

    @Column({ nullable: true })
    displayName: string

    @Column({ default: "CANARY-TYPEORM-DEFAULT", comment: "CANARY-TYPEORM-COMMENT" })
    role: string

    @CreateDateColumn()
    createdAt: Date

    @OneToMany(() => Post, (post) => post.author)
    posts: Post[]
}
