using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SESMT.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ExpandProfessionalHistoryReason : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "motivo",
                schema: "core",
                table: "trabalhador_historico",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(50)",
                oldMaxLength: 50,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM core.trabalhador_historico WHERE length(motivo) > 50) THEN
                        RAISE EXCEPTION 'Há motivos profissionais com mais de 50 caracteres. Preserve os registros antes de reduzir esta coluna.';
                    END IF;
                END $$;
                """);
            migrationBuilder.AlterColumn<string>(
                name: "motivo",
                schema: "core",
                table: "trabalhador_historico",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);
        }
    }
}
