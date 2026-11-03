using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SESMT.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTrainingEvidence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "comprovante_documento_id",
                schema: "core",
                table: "treinamento_registro",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "comprovante_hash",
                schema: "core",
                table: "treinamento_registro",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "comprovante_numero_versao",
                schema: "core",
                table: "treinamento_registro",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "comprovante_revisao_documento",
                schema: "core",
                table: "treinamento_registro",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "comprovante_revisao_treinamento",
                schema: "core",
                table: "treinamento_registro",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "comprovante_versao_id",
                schema: "core",
                table: "treinamento_registro",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "comprovante_vinculado_em",
                schema: "core",
                table: "treinamento_registro",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_treinamento_registro_comprovante_documento_id",
                schema: "core",
                table: "treinamento_registro",
                column: "comprovante_documento_id");

            migrationBuilder.CreateIndex(
                name: "IX_treinamento_registro_comprovante_versao_id",
                schema: "core",
                table: "treinamento_registro",
                column: "comprovante_versao_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_treinamento_comprovante",
                schema: "core",
                table: "treinamento_registro",
                sql: "(comprovante_documento_id IS NULL AND comprovante_versao_id IS NULL AND comprovante_numero_versao IS NULL AND comprovante_revisao_documento IS NULL AND comprovante_hash IS NULL AND comprovante_revisao_treinamento IS NULL AND comprovante_vinculado_em IS NULL) OR (comprovante_documento_id IS NOT NULL AND comprovante_versao_id IS NOT NULL AND comprovante_numero_versao IS NOT NULL AND comprovante_revisao_documento IS NOT NULL AND comprovante_hash IS NOT NULL AND comprovante_revisao_treinamento IS NOT NULL AND comprovante_numero_versao > 0 AND comprovante_revisao_documento > 0 AND comprovante_hash ~ '^[a-f0-9]{64}$' AND comprovante_revisao_treinamento > 0 AND comprovante_revisao_treinamento <= revisao AND comprovante_vinculado_em IS NOT NULL)");

            migrationBuilder.AddForeignKey(
                name: "FK_treinamento_registro_documento_comprovante_documento_id",
                schema: "core",
                table: "treinamento_registro",
                column: "comprovante_documento_id",
                principalSchema: "docs",
                principalTable: "documento",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_treinamento_registro_documento_versao_comprovante_versao_id",
                schema: "core",
                table: "treinamento_registro",
                column: "comprovante_versao_id",
                principalSchema: "docs",
                principalTable: "documento_versao",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM core.treinamento_registro WHERE comprovante_documento_id IS NOT NULL) THEN
                        RAISE EXCEPTION 'Há comprovantes vinculados a treinamentos. Preserve os vínculos antes de remover estas colunas.';
                    END IF;
                END $$;
                """);
            migrationBuilder.DropForeignKey(
                name: "FK_treinamento_registro_documento_comprovante_documento_id",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropForeignKey(
                name: "FK_treinamento_registro_documento_versao_comprovante_versao_id",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropIndex(
                name: "IX_treinamento_registro_comprovante_documento_id",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropIndex(
                name: "IX_treinamento_registro_comprovante_versao_id",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropCheckConstraint(
                name: "ck_treinamento_comprovante",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropColumn(
                name: "comprovante_documento_id",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropColumn(
                name: "comprovante_hash",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropColumn(
                name: "comprovante_numero_versao",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropColumn(
                name: "comprovante_revisao_documento",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropColumn(
                name: "comprovante_revisao_treinamento",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropColumn(
                name: "comprovante_versao_id",
                schema: "core",
                table: "treinamento_registro");

            migrationBuilder.DropColumn(
                name: "comprovante_vinculado_em",
                schema: "core",
                table: "treinamento_registro");
        }
    }
}
