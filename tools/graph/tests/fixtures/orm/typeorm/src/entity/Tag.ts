import { Column, Entity, PrimaryColumn, Unique } from "typeorm"

@Entity({ name: "tags" })
@Unique(["label"])
export class Tag {
    @PrimaryColumn("varchar", { length: 40 })
    slug: string

    @Column("varchar", { length: 80 })
    label: string
}
