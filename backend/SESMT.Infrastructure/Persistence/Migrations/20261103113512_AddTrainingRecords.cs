using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SESMT.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTrainingRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "treinamento_registro",
                schema: "core",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    empresa_id = table.Column<Guid>(type: "uuid", nullable: false),
                    unidade_id = table.Column<Guid>(type: "uuid", nullable: false),
                    trabalhador_id = table.Column<Guid>(type: "uuid", nullable: false),
                    comando_id = table.Column<Guid>(type: "uuid", nullable: false),
                    titulo = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    referencia = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    tipo = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: false),
                    concluido_em = table.Column<DateOnly>(type: "date", nullable: false),
                    renovar_em = table.Column<DateOnly>(type: "date", nullable: true),
                    duracao_minutos = table.Column<int>(type: "integer", nullable: false),
                    instituicao = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    instrutor = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    local = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    conteudo = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    observacoes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    invalidado_em = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    motivo_invalidacao = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    revisao = table.Column<int>(type: "integer", nullable: false),
                    ativo = table.Column<bool>(type: "boolean", nullable: false),
                    criado_em = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    criado_por = table.Column<Guid>(type: "uuid", nullable: true),
                    atualizado_em = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    atualizado_por = table.Column<Guid>(type: "uuid", nullable: true),
                    excluido_em = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    excluido_por = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_treinamento_registro", x => x.id);
                    table.CheckConstraint("ck_treinamento_duracao", "duracao_minutos BETWEEN 1 AND 600000");
                    table.CheckConstraint("ck_treinamento_renovacao", "renovar_em IS NULL OR renovar_em >= concluido_em");
                    table.ForeignKey(
                        name: "FK_treinamento_registro_empresa_empresa_id",
                        column: x => x.empresa_id,
                        principalSchema: "core",
                        principalTable: "empresa",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_treinamento_registro_trabalhador_trabalhador_id",
                        column: x => x.trabalhador_id,
                        principalSchema: "core",
                        principalTable: "trabalhador",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_treinamento_registro_unidade_unidade_id",
                        column: x => x.unidade_id,
                        principalSchema: "core",
                        principalTable: "unidade",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_treinamento_registro_empresa_id_comando_id",
                schema: "core",
                table: "treinamento_registro",
                columns: new[] { "empresa_id", "comando_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_treinamento_registro_trabalhador_id",
                schema: "core",
                table: "treinamento_registro",
                column: "trabalhador_id");

            migrationBuilder.CreateIndex(
                name: "IX_treinamento_registro_unidade_id_trabalhador_id_renovar_em",
                schema: "core",
                table: "treinamento_registro",
                columns: new[] { "unidade_id", "trabalhador_id", "renovar_em" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "treinamento_registro",
                schema: "core");
        }
    }
}
